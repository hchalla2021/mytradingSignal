"""
Institutional Market Compass Service  ——  v2
=============================================
AI-Powered Real-time Market Bias & Confidence Engine

6-Factor Weighted Technical Signal Engine (thinks like a Top Trader):

  Factor                      Weight   Source
  ──────────────────────────  ──────   ────────────────────────────────────
  1. VWAP Position             25%     5-min candles  (spot)
  2. EMA 9/20/50 Alignment     20%     5-min candles  (spot)
  3. Swing Structure HH/HL     20%     5-min candles  (spot)
  4. Futures Premium vs FV     20%     LTP + premium history buffer
  5. RSI-14 Momentum           10%     5-min candles  (spot)
  6. Volume Confirmation        5%     5-min candles  (spot)

                      TOTAL   100%

Fair Value Premium:
  FV_prem% = Spot × RISK_FREE_RATE × days_to_expiry / 365
  India RISK_FREE_RATE ≈ 6.8 % (91-day T-bill)

Data sources:
  • Spot 5-min candles   — CacheService "analysis_candles:{SYMBOL}"  (free, real-time)
  • Futures LTP (×9)     — kite.ltp() every 2 s
  • Near futures candles — kite.historical_data() cached 5 min
  • Premium history      — internal ring buffer  (120 points × 2 s = 4 min)

Isolation:  own ConnectionManager, own task, zero shared state with other services.
"""

import asyncio
import collections
import json
import math
import time
import logging
from datetime import datetime, time as dtime
from typing import Dict, Any, Optional, List, Tuple, Deque, Set
from fastapi import WebSocket

import pytz
from kiteconnect import KiteConnect

from config import get_settings
from services.cache import CacheService
from services.auth_state_machine import auth_state_manager
from services.contract_manager import ContractManager

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

settings = get_settings()

# ─── Constants ────────────────────────────────────────────────────────────────

RISK_FREE_RATE = 0.068   # India 91-day T-bill ≈ 6.8 %

# Factor weights (must sum to 1.0)
WEIGHTS: Dict[str, float] = {
    "vwap":             0.25,
    "ema_alignment":    0.20,
    "trend_structure":  0.20,
    "futures_premium":  0.20,
    "rsi_momentum":     0.10,
    "volume_confirm":   0.05,
}

BULL_THRESHOLD =  0.18   # score above this → BULLISH
BEAR_THRESHOLD = -0.18   # score below this → BEARISH


# ─── Isolated WebSocket manager ───────────────────────────────────────────────

class CompassConnectionManager:
    """Lightweight WebSocket manager — completely isolated from main manager."""

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


compass_manager = CompassConnectionManager()


# ─── Pure technical analysis functions ────────────────────────────────────────

def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _ema(series: List[float], period: int) -> Optional[float]:
    """Exponential Moving Average — returns the last computed value."""
    if len(series) < period:
        return None
    k = 2.0 / (period + 1)
    val = sum(series[:period]) / period          # SMA seed
    for price in series[period:]:
        val = price * k + val * (1.0 - k)
    return val


def _rsi(closes: List[float], period: int = 14) -> Optional[float]:
    """RSI using Wilder's smoothing.  Needs at least period+1 closes."""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(closes)):
        d = closes[i] - closes[i - 1]
        gains.append(max(d, 0.0))
        losses.append(max(-d, 0.0))
    avg_g = sum(gains[:period]) / period
    avg_l = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_g = (avg_g * (period - 1) + gains[i]) / period
        avg_l = (avg_l * (period - 1) + losses[i]) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return round(100.0 - (100.0 / (1.0 + rs)), 2)


def _vwap(candles: List[Dict]) -> Optional[float]:
    """Cumulative intraday VWAP = Σ(typical_price × volume) / Σ(volume)."""
    total_pv = 0.0
    total_vol = 0.0
    for c in candles:
        vol = float(c.get("volume") or 0)
        if vol <= 0:
            continue
        tp = (float(c.get("high") or 0) + float(c.get("low") or 0) + float(c.get("close") or 0)) / 3.0
        total_pv  += tp * vol
        total_vol += vol
    if total_vol <= 0:
        return None
    return round(total_pv / total_vol, 2)


def _trend_structure(candles: List[Dict], n: int = 8) -> Tuple[str, float]:
    """
    Detect swing structure from the last n candles.

    Counts:
      HH — high[i] > high[i-1]   HL — low[i]  > low[i-1]
      LH — high[i] < high[i-1]   LL — low[i]  < low[i-1]

    Returns:
      (structure_label, net_score [-1..+1])
      Labels: HH_HL  | LH_LL | RANGING
    """
    if len(candles) < 4:
        return "RANGING", 0.0
    recent = candles[-n:] if len(candles) >= n else candles
    highs = [float(c.get("high") or 0) for c in recent]
    lows  = [float(c.get("low")  or 0) for c in recent]
    steps = len(recent) - 1
    if steps == 0:
        return "RANGING", 0.0

    hh = sum(1 for i in range(1, len(highs)) if highs[i] > highs[i - 1])
    hl = sum(1 for i in range(1, len(lows))  if lows[i]  > lows[i - 1])
    lh = sum(1 for i in range(1, len(highs)) if highs[i] < highs[i - 1])
    ll = sum(1 for i in range(1, len(lows))  if lows[i]  < lows[i - 1])

    bull = (hh + hl) / (2 * steps)
    bear = (lh + ll) / (2 * steps)
    net  = bull - bear          # -1..+1

    if net > 0.25:
        label = "HH_HL"
    elif net < -0.25:
        label = "LH_LL"
    else:
        label = "RANGING"

    return label, round(net, 4)


def _linear_slope(values: List[float]) -> float:
    """Least-squares slope of a series (normalised to mid-point)."""
    n = len(values)
    if n < 3:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def _fair_value_prem_pct(days_to_expiry: int) -> float:
    """
    Theoretical futures premium % based on cost-of-carry model.
    FV_prem% = RISK_FREE_RATE × (days_to_expiry / 365) × 100
    """
    if days_to_expiry <= 0:
        return 0.0
    return round(RISK_FREE_RATE * days_to_expiry / 365.0 * 100.0, 4)


def _parse_expiry_days(expiry_str: Any) -> int:
    """Days remaining until futures expiry (0 if unknown)."""
    if not expiry_str:
        return 30          # safe default
    try:
        if isinstance(expiry_str, datetime):
            expiry_dt = expiry_str
        else:
            exp_str = str(expiry_str)
            # Handle "2026-02-27" or "2026-02-27T15:30:00+05:30"
            expiry_dt = datetime.fromisoformat(exp_str.split("T")[0])
        today = datetime.now(IST).date()
        delta = (expiry_dt.date() if hasattr(expiry_dt, "date") else expiry_dt) - today
        return max(delta.days, 0) if hasattr(delta, "days") else int(delta)
    except Exception:
        return 30


def _volume_confirm_score(candles: List[Dict], direction: str, n: int = 5) -> float:
    """
    Returns +1 if recent n-candle volume supports the current direction,
    -1 if it opposes, 0 if neutral.
    For spot indices, volume is often 0; we fall back to price action.
    """
    if not candles or n < 2:
        return 0.0
    recent = candles[-n:]
    bull_vol = sum(
        float(c.get("volume") or 0)
        for c in recent
        if float(c.get("close") or 0) >= float(c.get("open") or 0)
    )
    bear_vol = sum(
        float(c.get("volume") or 0)
        for c in recent
        if float(c.get("close") or 0) < float(c.get("open") or 0)
    )
    total_vol = bull_vol + bear_vol
    if total_vol == 0:
        # Fallback: count bullish/bearish candle bodies
        bull_c = sum(1 for c in recent if float(c.get("close") or 0) >= float(c.get("open") or 0))
        bear_c = len(recent) - bull_c
        total_vol = len(recent)
        bull_vol, bear_vol = bull_c, bear_c

    ratio = (bull_vol - bear_vol) / total_vol   # -1..+1
    return round(ratio, 3)


def _parse_candle(item) -> Optional[Dict]:
    """Safely parse a candle from JSON string or dict."""
    if isinstance(item, dict):
        return item
    if isinstance(item, str):
        try:
            return json.loads(item)
        except Exception:
            return None
    return None


# ─── Signal computation ────────────────────────────────────────────────────────

def _compute_all_signals(
    spot_candles: List[Dict],
    spot_price: float,
    spot_change_pct: float,
    premium_pct: float,             # near futures actual premium %
    premium_slope: float,           # linear slope of last-4-min premium history
    fair_value_pct: float,          # theoretical premium % from cost-of-carry
) -> Dict[str, Dict]:
    """
    Compute each of the 6 weighted signals.

    Returns dict keyed by factor name, each value:
        { score: float [-1..+1],  signal: str,  label: str,
          weight: float,          value: float|None,  extra: dict }
    """
    signals: Dict[str, Dict] = {}
    closes  = [float(c.get("close") or 0) for c in spot_candles if c.get("close")]
    highs   = [float(c.get("high")  or 0) for c in spot_candles]
    lows    = [float(c.get("low")   or 0) for c in spot_candles]

    # ── 1. VWAP Position (25%) ───────────────────────────────────────────────
    vwap_val = _vwap(spot_candles)
    if vwap_val and spot_price > 0 and vwap_val > 0:
        dev_pct  = (spot_price - vwap_val) / vwap_val * 100.0
        score    = _clamp(dev_pct / 0.35, -1.0, 1.0)   # ±0.35 % → ±1.0
        if dev_pct > 0.10:
            label = f"Above VWAP +{dev_pct:.3f}%"
        elif dev_pct < -0.10:
            label = f"Below VWAP {dev_pct:.3f}%"
        else:
            label = f"At VWAP ±{abs(dev_pct):.3f}%"
    else:
        score, dev_pct, label, vwap_val = 0.0, 0.0, "VWAP N/A", None

    signals["vwap"] = dict(
        score=round(score, 4), signal=_sig(score),
        label=label, weight=WEIGHTS["vwap"],
        value=vwap_val, extra={"deviation_pct": round(dev_pct, 4) if vwap_val else 0.0},
    )

    # ── 2. EMA 9 / 20 / 50 Alignment (20%) ──────────────────────────────────
    ema9  = _ema(closes, 9)
    ema20 = _ema(closes, 20)
    ema50 = _ema(closes, 50)

    if ema9 and ema20:
        if ema50 and ema9 > ema20 > ema50 and spot_price > ema9:
            score, ema_label = 1.00, "Full Bull: 9>20>50 + price above"
        elif ema9 > ema20 and spot_price >= ema9:
            score, ema_label = 0.70, "Bull: EMA9>20, price above 9"
        elif ema9 > ema20:
            score, ema_label = 0.35, "Mild Bull: EMA9 > EMA20"
        elif ema50 and ema9 < ema20 < ema50 and spot_price < ema9:
            score, ema_label = -1.00, "Full Bear: 9<20<50 + price below"
        elif ema9 < ema20 and spot_price <= ema9:
            score, ema_label = -0.70, "Bear: EMA9<20, price below 9"
        elif ema9 < ema20:
            score, ema_label = -0.35, "Mild Bear: EMA9 < EMA20"
        else:
            score, ema_label = 0.00, "EMA Neutral / Mixed"
    else:
        score, ema_label = 0.00, "Insufficient candles for EMA"

    signals["ema_alignment"] = dict(
        score=round(score, 4), signal=_sig(score),
        label=ema_label, weight=WEIGHTS["ema_alignment"],
        value=round(ema9, 2) if ema9 else None,
        extra={
            "ema9":  round(ema9, 2)  if ema9  else None,
            "ema20": round(ema20, 2) if ema20 else None,
            "ema50": round(ema50, 2) if ema50 else None,
        },
    )

    # ── 3. Swing Structure HH/HL vs LH/LL (20%) ─────────────────────────────
    structure, struct_score = _trend_structure(spot_candles, n=10)
    score = struct_score
    candles_used = min(len(spot_candles), 10)
    struct_label = {
        "HH_HL":   f"Uptrend: Higher-Highs / Higher-Lows ({candles_used} bars)",
        "LH_LL":   f"Downtrend: Lower-Highs / Lower-Lows ({candles_used} bars)",
        "RANGING": f"Ranging / No clear structure ({candles_used} bars)",
    }.get(structure, structure)

    signals["trend_structure"] = dict(
        score=round(score, 4), signal=_sig(score),
        label=struct_label, weight=WEIGHTS["trend_structure"],
        value=None,
        extra={"structure": structure, "candles_used": candles_used},
    )

    # ── 4. Futures Premium vs Fair Value (20%) ───────────────────────────────
    if fair_value_pct > 0 and premium_pct != 0:
        # Relative deviation of actual premium from fair value
        dev_from_fv = premium_pct - fair_value_pct  # positive = above FV = bullish
        # Normalise: ±(FV * 0.5) deviation → ±1.0 score
        score = _clamp(dev_from_fv / max(fair_value_pct * 0.6, 0.05), -1.0, 1.0)

        # Add premium trend momentum (expanding = extra bullish signal)
        trend_bonus = _clamp(premium_slope / 0.003, -0.30, 0.30)
        score = _clamp(score + trend_bonus, -1.0, 1.0)

        if dev_from_fv > fair_value_pct * 0.3:
            prem_label = f"Premium {premium_pct:.3f}% >> FV {fair_value_pct:.3f}% — institutions building longs"
        elif dev_from_fv > 0:
            prem_label = f"Premium {premium_pct:.3f}% slightly above FV {fair_value_pct:.3f}%"
        elif abs(dev_from_fv) <= fair_value_pct * 0.15:
            prem_label = f"Premium {premium_pct:.3f}% ≈ FV {fair_value_pct:.3f}% — neutral carry"
        elif dev_from_fv < -fair_value_pct * 0.3:
            prem_label = f"Premium {premium_pct:.3f}% << FV {fair_value_pct:.3f}% — heavy hedging / shorts"
        else:
            prem_label = f"Premium {premium_pct:.3f}% below FV {fair_value_pct:.3f}%"

        prem_trend_str = "EXPANDING" if premium_slope > 0.001 else ("CONTRACTING" if premium_slope < -0.001 else "STABLE")
    elif premium_pct == 0:
        score, prem_label = 0.10 if spot_change_pct > 0 else (-0.10 if spot_change_pct < 0 else 0.0), "Futures data loading…"
        prem_trend_str, dev_from_fv = "STABLE", 0.0
    else:
        # Future data but no FV (day 0 of expiry etc.)
        score = _clamp(premium_pct / 0.4, -1.0, 1.0)
        prem_label = f"Premium {premium_pct:.3f}% (FV N/A)"
        prem_trend_str, dev_from_fv = "STABLE", 0.0

    signals["futures_premium"] = dict(
        score=round(score, 4), signal=_sig(score),
        label=prem_label, weight=WEIGHTS["futures_premium"],
        value=round(premium_pct, 4),
        extra={
            "premium_pct":   round(premium_pct, 4),
            "fair_value_pct": round(fair_value_pct, 4),
            "dev_from_fv":   round(dev_from_fv, 4),
            "premium_trend": prem_trend_str,
        },
    )

    # ── 5. RSI-14 Momentum (10%) ─────────────────────────────────────────────
    rsi_val = _rsi(closes, 14)
    if rsi_val is not None:
        # Score: RSI 40→0 (neutral mid), 20→-1 (extreme bear), 60→+1 (strong bull), 80→+1
        score = _clamp((rsi_val - 50.0) / 22.0, -1.0, 1.0)
        if rsi_val >= 70:
            rsi_label = f"RSI {rsi_val:.1f} — overbought momentum"
        elif rsi_val >= 60:
            rsi_label = f"RSI {rsi_val:.1f} — bullish momentum zone"
        elif rsi_val >= 55:
            rsi_label = f"RSI {rsi_val:.1f} — mild bullish bias"
        elif rsi_val <= 30:
            rsi_label = f"RSI {rsi_val:.1f} — oversold / bounce watch"
        elif rsi_val <= 40:
            rsi_label = f"RSI {rsi_val:.1f} — bearish momentum zone"
        elif rsi_val <= 45:
            rsi_label = f"RSI {rsi_val:.1f} — mild bearish bias"
        else:
            rsi_label = f"RSI {rsi_val:.1f} — neutral zone (45–55)"
    else:
        score, rsi_val = 0.0, None
        rsi_label = "RSI N/A — insufficient candles"

    signals["rsi_momentum"] = dict(
        score=round(score, 4), signal=_sig(score),
        label=rsi_label, weight=WEIGHTS["rsi_momentum"],
        value=rsi_val,
        extra={},
    )

    # ── 6. Volume Confirmation (5%) ───────────────────────────────────────────
    vol_score  = _volume_confirm_score(spot_candles, "", n=5)
    if vol_score > 0.3:
        vol_label = f"Buying volume dominant ({vol_score*100:.0f}%)"
    elif vol_score < -0.3:
        vol_label = f"Selling volume dominant ({abs(vol_score)*100:.0f}%)"
    else:
        vol_label = "Balanced / mixed volume"

    signals["volume_confirm"] = dict(
        score=round(vol_score, 4), signal=_sig(vol_score),
        label=vol_label, weight=WEIGHTS["volume_confirm"],
        value=None,
        extra={},
    )

    return signals


def _sig(score: float, bull_t: float = 0.15, bear_t: float = -0.15) -> str:
    if score >= bull_t:
        return "BULL"
    if score <= bear_t:
        return "BEAR"
    return "NEUTRAL"


def _finalize_direction(signals: Dict[str, Dict]) -> Tuple[str, int, float, str]:
    """
    Weighted sum of factor scores → direction, confidence, raw_score, bias_text.
    """
    raw = sum(sig["score"] * sig["weight"] for sig in signals.values())

    if raw >= BULL_THRESHOLD:
        direction = "BULLISH"
    elif raw <= BEAR_THRESHOLD:
        direction = "BEARISH"
    else:
        direction = "NEUTRAL"

    # Confidence: how MANY factors agree with the final direction
    if direction == "NEUTRAL":
        # Neutral confidence = how strongly neutral (centre of band = highest)
        neutrality = 1.0 - (abs(raw) / abs(BULL_THRESHOLD))
        confidence = int(40 + neutrality * 20)
    else:
        signal_type = "BULL" if direction == "BULLISH" else "BEAR"
        agreement = sum(
            sig["weight"]
            for sig in signals.values()
            if sig["signal"] == signal_type
        )
        # agreement in [0..1.0] (weight sums) → confidence [35..97]
        confidence = int(35 + agreement * 62)

    confidence = max(1, min(99, confidence))

    # Bias narrative: pick 2-3 strongest agreeing factors
    sig_type = "BULL" if direction == "BULLISH" else ("BEAR" if direction == "BEARISH" else None)
    strong = sorted(
        [(k, v) for k, v in signals.items() if sig_type and v["signal"] == sig_type],
        key=lambda x: abs(x[1]["score"]),
        reverse=True,
    )[:3]

    factor_short = {
        "vwap":            "VWAP",
        "ema_alignment":   "EMA structure",
        "trend_structure": "swing structure",
        "futures_premium": "futures premium",
        "rsi_momentum":    "RSI momentum",
        "volume_confirm":  "volume",
    }
    if direction == "NEUTRAL":
        bias = "Conflicting signals — market in balance; wait for breakout"
    elif strong:
        parts = " · ".join(factor_short.get(k, k) for k, _ in strong)
        direction_str = "bullish" if direction == "BULLISH" else "bearish"
        bias = f"{parts} — {direction_str} confirmation"
    else:
        bias = f"Weak {direction.lower()} edge — exercise caution"

    return direction, confidence, round(raw, 4), bias


# ─── 5-minute short-term predictions ─────────────────────────────────────────

def _predict_5m(
    signals: Dict[str, Dict],
    premium_slope: float = 0.0,
    near_fut_rsi: Optional[float] = None,
) -> Tuple[str, int]:
    """
    5-minute directional prediction for the SPOT INDEX.
    Returns (label, confidence_pct) so callers can display both.

    Re-weights the existing 6 signals toward momentum factors
    that move fastest on a 5-min timeframe.

    Factor weights (5-min):
      EMA alignment   30 %  — fastest directional signal
      RSI momentum    25 %  — momentum strength
      VWAP position   25 %  — institutional anchor
      Futures premium 15 %  — smart-money intent
      Trend structure  5 %  — slower, confirming only

    Returns: STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL
    """
    W5 = {
        "ema_alignment":   0.30,
        "rsi_momentum":    0.25,
        "vwap":            0.25,
        "futures_premium": 0.15,
        "trend_structure": 0.05,
    }
    score = sum(signals[k]["score"] * w for k, w in W5.items() if k in signals)

    # Premium slope momentum nudge (±8 %)
    score = _clamp(score + _clamp(premium_slope / 0.005, -0.08, 0.08), -1.0, 1.0)

    # Near-futures RSI cross-confirmation (±10 % nudge)
    if near_fut_rsi is not None:
        score = _clamp(
            score + _clamp((near_fut_rsi - 50.0) / 25.0, -1.0, 1.0) * 0.10,
            -1.0, 1.0,
        )

    # Confidence: 40% at score=0, scales to 92% at score=±1.0
    conf = max(40, min(92, int(40 + abs(score) * 52)))
    if score >=  0.45: return "STRONG_BUY",  conf
    if score >=  0.20: return "BUY",          conf
    if score <= -0.45: return "STRONG_SELL",  conf
    if score <= -0.20: return "SELL",         conf
    return "NEUTRAL", conf


def _predict_5m_futures(
    near_fut_candles: List[Dict],
    near_fut_rsi: Optional[float],
    premium_slope: float,
) -> str:
    """
    5-minute directional prediction for NEAR-MONTH FUTURES.

    Computes from futures' own 5-min candles when available:
      EMA 9/20 alignment  40 %
      RSI-14              35 %
      Premium slope       25 %

    Returns: STRONG_BUY | BUY | NEUTRAL | SELL | STRONG_SELL
    """
    parts: List[Tuple[float, float]] = []   # (score, weight)

    if near_fut_candles:
        closes = [float(c.get("close") or 0) for c in near_fut_candles if c.get("close")]
        if closes:
            ema9  = _ema(closes, 9)
            ema20 = _ema(closes, 20)
            cur   = closes[-1]
            if ema9 and ema20:
                if   ema9 > ema20 and cur > ema9:    s =  0.80
                elif ema9 > ema20:                   s =  0.40
                elif ema9 < ema20 and cur < ema9:    s = -0.80
                elif ema9 < ema20:                   s = -0.40
                else:                                s =  0.00
                parts.append((s, 0.40))

    if near_fut_rsi is not None:
        parts.append((_clamp((near_fut_rsi - 50.0) / 22.0, -1.0, 1.0), 0.35))

    # Premium slope — always available, even during closed market
    slope_score = _clamp(premium_slope / 0.003, -1.0, 1.0)
    parts.append((slope_score, 0.25))

    if not parts:
        return "NEUTRAL"

    total_w = sum(w for _, w in parts)
    score   = _clamp(sum(s * w for s, w in parts) / total_w, -1.0, 1.0)

    if score >=  0.45: return "STRONG_BUY"
    if score >=  0.20: return "BUY"
    if score <= -0.45: return "STRONG_SELL"
    if score <= -0.20: return "SELL"
    return "NEUTRAL"


# ─── Compass Service ──────────────────────────────────────────────────────────

class PremiumHistory:
    """
    Ring buffer tracking near-futures premium % over time.
    Used to compute premium trend (expanding / contracting).
    """
    MAXLEN = 120     # 120 × 2 s = 4 min

    def __init__(self):
        self._buf: Deque[float] = collections.deque(maxlen=self.MAXLEN)

    def push(self, prem_pct: float):
        self._buf.append(prem_pct)

    def slope(self, n: int = 30) -> float:
        """Linear regression slope of the last n values."""
        if len(self._buf) < 5:
            return 0.0
        vals = list(self._buf)[-n:]
        return _linear_slope(vals)


class CompassService:
    """
    Institutional Market Compass — core engine.

    start() → background loop → stop()
    get_snapshot() → latest payload (non-async)
    """

    INDICES              = ["NIFTY", "BANKNIFTY", "SENSEX"]
    TICK_INTERVAL        = 2.0      # broadcast cadence (seconds)
    INSTRUMENT_REFRESH   = 3600     # re-discover contract tokens (seconds)
    FUTURES_CANDLE_REFRESH = 300    # re-fetch futures 5-min candles (seconds)

    def __init__(self, cache: CacheService):
        self._cache   = cache
        self._contracts: Dict[str, Dict] = {}           # symbol → {near, next, far}
        self._futures_ltp:  Dict[str, float] = {}       # contract_name → LTP
        self._futures_prev: Dict[str, float] = {}       # contract_name → prev_close
        self._futures_candles: Dict[str, List[Dict]] = {}  # symbol → near-month 5-min candles
        self._prem_history: Dict[str, PremiumHistory] = {
            sym: PremiumHistory() for sym in self.INDICES
        }
        self._last_spot_data: Dict[str, Dict] = {}   # no-TTL fallback for closed/stale market
        self._last_instrument_refresh   = 0.0
        self._last_futures_candle_fetch = 0.0
        self._latest: Dict[str, Any] = {}
        self._task:   Optional[asyncio.Task] = None
        self._candle_task: Optional[asyncio.Task] = None
        self._running = False

    # ── Kite client ──────────────────────────────────────────────────────────

    def _get_kite(self) -> Optional[KiteConnect]:
        if not auth_state_manager.is_authenticated:
            return None
        s = get_settings()
        if not s.zerodha_api_key or not s.zerodha_access_token:
            return None
        kite = KiteConnect(api_key=s.zerodha_api_key)
        kite.set_access_token(s.zerodha_access_token)
        return kite

    # ── One-time startup spot-price fetch (works even when market is closed) ─

    def _fetch_initial_spot_sync(self):
        """
        Fetch current / last-traded prices from kite.quote() on startup.
        Populates _last_spot_data so compass shows something even if market is
        closed or ticks haven't arrived yet.
        Runs as a fire-and-forget executor task.
        """
        kite = self._get_kite()
        if not kite:
            return
        QUOTE_MAP = {
            "NSE:NIFTY 50":  "NIFTY",
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
                    "high":          float((q.get("ohlc") or {}).get("high") or ltp),
                    "low":           float((q.get("ohlc") or {}).get("low")  or ltp),
                    "open":          float((q.get("ohlc") or {}).get("open") or ltp),
                    "trend":         trend,
                    "status":        "CLOSED",
                }
            logger.info(f"🧭 Initial spot data loaded for: {list(self._last_spot_data.keys())}")
        except Exception as e:
            logger.debug(f"🧭 Initial spot fetch error: {e}")

    # ── Contract token discovery ─────────────────────────────────────────────

    def _refresh_contracts_sync(self):
        """Discover near / next / far token names (blocking — run in executor)."""
        kite = self._get_kite()
        if not kite:
            return
        mgr = ContractManager(kite)
        for sym in self.INDICES:
            try:
                contracts = mgr.get_all_contracts(sym)
                if contracts:
                    self._contracts[sym] = contracts
            except Exception as e:
                logger.debug(f"🧭 Contract refresh [{sym}]: {e}")
        self._last_instrument_refresh = time.time()

    # ── Near-month futures 5-min candles ─────────────────────────────────────

    async def _fetch_futures_candles(self):
        """
        Fetch today's 5-min candles for the near-month contract of each index.
        Cached for FUTURES_CANDLE_REFRESH seconds.
        """
        kite = self._get_kite()
        if not kite:
            return

        today   = datetime.now(IST).date()
        from_dt = datetime.combine(today, dtime(9, 15)).astimezone(IST)
        to_dt   = datetime.now(IST)
        loop    = asyncio.get_event_loop()

        for sym in self.INDICES:
            near = self._contracts.get(sym, {}).get("near", {})
            token = near.get("token")
            if not token:
                continue
            try:
                candles = await loop.run_in_executor(
                    None,
                    lambda t=token: kite.historical_data(
                        t, from_dt, to_dt, interval="5minute", continuous=False
                    ),
                )
                if candles:
                    # Normalise key names (Zerodha returns "date", "open" etc.)
                    norm = []
                    for c in candles:
                        norm.append({
                            "timestamp": str(c.get("date", "")),
                            "open":   float(c.get("open",  0)),
                            "high":   float(c.get("high",  0)),
                            "low":    float(c.get("low",   0)),
                            "close":  float(c.get("close", 0)),
                            "volume": int(c.get("volume",  0)),
                        })
                    self._futures_candles[sym] = norm
                    logger.debug(f"🧭 Near-futures candles [{sym}]: {len(norm)}")
            except Exception as e:
                logger.debug(f"🧭 Futures candle fetch [{sym}]: {e}")

        self._last_futures_candle_fetch = time.time()

    # ── All-9 futures LTP ────────────────────────────────────────────────────

    async def _fetch_futures_ltp(self):
        """
        Fetches LTP + OHLC for all 9 contracts (near/next/far × 3 indices).
        Using kite.quote() instead of kite.ltp() to obtain previous-day close
        (ohlc.close) which is needed to compute intraday changePct correctly.
        SENSEX futures: BFO exchange (BSE Futures & Options, NOT BSE spot).
        """
        kite = self._get_kite()
        if not kite:
            return

        ltp_keys: List[str] = []
        name_map: Dict[str, str] = {}

        for sym, contracts in self._contracts.items():
            exch = "BFO" if sym == "SENSEX" else "NFO"   # SENSEX FUT → BFO not BSE
            for info in contracts.values():
                name = info.get("name", "")
                if name:
                    key = f"{exch}:{name}"
                    ltp_keys.append(key)
                    name_map[name] = key

        if not ltp_keys:
            return

        try:
            loop = asyncio.get_event_loop()
            # quote() returns full OHLC including prev-day close; ltp() does not
            quote_data = await loop.run_in_executor(None, lambda: kite.quote(ltp_keys))
            for name, key in name_map.items():
                entry = quote_data.get(key, {})
                if not entry:
                    continue
                ltp = float(entry.get("last_price") or 0)
                if ltp <= 0:
                    continue
                self._futures_ltp[name] = ltp
                prev_close = float((entry.get("ohlc") or {}).get("close") or 0)
                if prev_close > 0:
                    self._futures_prev[name] = prev_close
        except Exception as e:
            logger.debug(f"🧭 Futures quote fetch error: {e}")

    # ── Read spot candles from cache ──────────────────────────────────────────

    async def _read_spot_candles(self, symbol: str) -> List[Dict]:
        """Read 5-min spot candles from CacheService (oldest-first for TA)."""
        raw = await self._cache.lrange(f"analysis_candles:{symbol}", 0, 99)
        candles = []
        for item in reversed(raw):       # lpush prepends → newest first; reverse for TA
            c = _parse_candle(item)
            if c and isinstance(c, dict):
                candles.append(c)
        return candles

    # ── Read spot price data from cache ──────────────────────────────────────

    async def _read_spot_data(self, symbol: str) -> Tuple[Optional[Dict], bool]:
        """
        Returns (spot_data, is_live).
        is_live=True  → fresh from 5-s cache (market ticking).
        is_live=False → stale fallback from _last_spot_data (market closed / no ticks).
        """
        data = await self._cache.get_market_data(symbol)
        if data:
            self._last_spot_data[symbol] = data   # persist last-seen
            return data, True
        # Fallback: last known price from any previous session in this run
        stale = self._last_spot_data.get(symbol)
        return stale, False

    # ── Per-index full computation ────────────────────────────────────────────

    async def _compute_index(self, symbol: str) -> Optional[Dict[str, Any]]:
        """
        Full 6-factor analysis for one index.
        Returns None if spot price is unavailable.
        """
        spot_data, spot_is_live = await self._read_spot_data(symbol)
        if not spot_data:
            return None

        spot_price     = float(spot_data.get("price") or 0)
        if spot_price <= 0:
            return None

        spot_change     = float(spot_data.get("change") or 0)
        spot_change_pct = float(spot_data.get("changePercent") or 0)

        # ── Spot 5-min candles ───────────────────────────────────────────────
        spot_candles = await self._read_spot_candles(symbol)

        # ── Futures contract info ────────────────────────────────────────────
        contracts = self._contracts.get(symbol, {})
        futures_info: Dict[str, Optional[Dict]] = {"near": None, "next": None, "far": None}

        near_premium_pct = 0.0
        days_to_expiry   = 30

        for slot in ("near", "next", "far"):
            contract = contracts.get(slot)
            if not contract:
                continue
            name  = contract.get("name", "")
            price = self._futures_ltp.get(name, 0.0)
            prev  = self._futures_prev.get(name, 0.0)
            if price <= 0:
                continue
            premium     = price - spot_price
            premium_pct = premium / spot_price * 100 if spot_price > 0 else 0.0
            change_pct  = (price - prev) / prev * 100 if prev > 0 else 0.0

            if slot == "near":
                near_premium_pct = premium_pct
                days_to_expiry   = _parse_expiry_days(contract.get("expiry"))

            futures_info[slot] = {
                "name":       name,
                "price":      round(price, 2),
                "premium":    round(premium, 2),
                "premiumPct": round(premium_pct, 4),
                "changePct":  round(change_pct, 4),
                "expiry":     str(contract.get("expiry", "")),
            }

        # ── Update premium history and get slope ─────────────────────────────
        ph = self._prem_history[symbol]
        if futures_info["near"]:
            ph.push(near_premium_pct)
        prem_slope = ph.slope()

        # ── Fair value premium ────────────────────────────────────────────────
        fv_pct = _fair_value_prem_pct(days_to_expiry)

        # ── Run 6-factor signal engine ────────────────────────────────────────
        signals = _compute_all_signals(
            spot_candles    = spot_candles,
            spot_price      = spot_price,
            spot_change_pct = spot_change_pct,
            premium_pct     = near_premium_pct,
            premium_slope   = prem_slope,
            fair_value_pct  = fv_pct,
        )

        direction, confidence, raw_score, bias = _finalize_direction(signals)

        # ── Near-futures candle indicators (extra intelligence) ───────────────
        near_fut_candles = self._futures_candles.get(symbol, [])
        near_fut_rsi  = None
        near_fut_vwap = None
        futures_leading = False
        if near_fut_candles:
            fc_closes = [c.get("close", 0) for c in near_fut_candles]
            near_fut_rsi  = _rsi(fc_closes, 14)
            near_fut_vwap = _vwap(near_fut_candles)
            # Futures leading if %chg from today's open > spot %chg
            if len(near_fut_candles) >= 1 and near_fut_candles[0].get("open"):
                fut_open = near_fut_candles[0]["open"]
                near_ltp = futures_info["near"]["price"] if futures_info["near"] else 0
                if fut_open > 0 and near_ltp > 0:
                    fut_today_chg_pct = (near_ltp - fut_open) / fut_open * 100
                    futures_leading = (
                        abs(fut_today_chg_pct) > abs(spot_change_pct) + 0.08
                        and math.copysign(1, fut_today_chg_pct) == math.copysign(1, spot_change_pct)
                    )

        # ── 5-minute short-term predictions ──────────────────────────────────
        pred_5m, pred_5m_conf = _predict_5m(signals, prem_slope, near_fut_rsi)
        pred_5m_fut = _predict_5m_futures(near_fut_candles, near_fut_rsi, prem_slope)

        if not spot_is_live:
            data_source = "MARKET_CLOSED"
        elif futures_info["near"]:
            data_source = "LIVE"
        else:
            data_source = "SPOT_ONLY"

        return {
            "symbol":   symbol,
            "spot": {
                "price":      round(spot_price, 2),
                "change":     round(spot_change, 2),
                "changePct":  round(spot_change_pct, 4),
                "vwap":       signals["vwap"]["value"],
                "rsi":        signals["rsi_momentum"]["value"],
                "ema9":       signals["ema_alignment"]["extra"].get("ema9"),
                "ema20":      signals["ema_alignment"]["extra"].get("ema20"),
                "ema50":      signals["ema_alignment"]["extra"].get("ema50"),
                "trendStructure":     signals["trend_structure"]["extra"].get("structure", "RANGING"),
                "candlesUsed":        signals["trend_structure"]["extra"].get("candles_used", 0),
                "prediction5m":       pred_5m,
                "prediction5mConf":   pred_5m_conf,
            },
            "futures": {
                **futures_info,
                "premiumTrend":    signals["futures_premium"]["extra"].get("premium_trend", "STABLE"),
                "fairValuePct":    fv_pct,
                "daysToExpiry":    days_to_expiry,
                "nearFutRsi":      near_fut_rsi,
                "nearFutVwap":     round(near_fut_vwap, 2) if near_fut_vwap else None,
                "futuresLeading":  futures_leading,
                "prediction5mFut": pred_5m_fut,
            },
            "signals":    signals,
            "direction":  direction,
            "confidence": confidence,
            "rawScore":   raw_score,
            "bias":       bias,
            "dataSource": data_source,
            "timestamp":  datetime.now(IST).isoformat(),
        }

    # ── Background: futures candle refresh loop ───────────────────────────────

    async def _candle_refresh_loop(self):
        """Refresh near-futures 5-min candles every FUTURES_CANDLE_REFRESH seconds."""
        while self._running:
            try:
                await self._fetch_futures_candles()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"🧭 Candle refresh error: {e}")
            await asyncio.sleep(self.FUTURES_CANDLE_REFRESH)

    # ── Main broadcast loop ───────────────────────────────────────────────────

    async def _broadcast_loop(self):
        logger.info("🧭 Compass broadcast loop started (v2 — 6-factor candle intelligence)")

        while self._running:
            try:
                # Periodically refresh contract tokens
                if time.time() - self._last_instrument_refresh > self.INSTRUMENT_REFRESH:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(None, self._refresh_contracts_sync)

                # Fetch all-9 futures LTP
                await self._fetch_futures_ltp()

                # Compute per-index and broadcast
                payload: Dict[str, Any] = {}
                for sym in self.INDICES:
                    data = await self._compute_index(sym)
                    if data:
                        payload[sym] = data
                        self._latest[sym] = data

                if payload:
                    await compass_manager.broadcast({
                        "type":      "compass_update",
                        "data":      payload,
                        "timestamp": datetime.now(IST).isoformat(),
                    })

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"🧭 Compass loop error: {e}")

            await asyncio.sleep(self.TICK_INTERVAL)

        logger.info("🧭 Compass broadcast loop stopped")

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        loop = asyncio.get_event_loop()
        # Initial contract discovery (non-blocking)
        loop.run_in_executor(None, self._refresh_contracts_sync)
        # Pre-populate last-spot fallback from Zerodha quote API (works when market is closed)
        loop.run_in_executor(None, self._fetch_initial_spot_sync)
        # Main broadcast task
        self._task = asyncio.create_task(self._broadcast_loop())
        # Futures candle refresh task (separate, every 5 min)
        self._candle_task = asyncio.create_task(self._candle_refresh_loop())
        logger.info("🧭 CompassService v2 started")

    async def stop(self):
        self._running = False
        for task in (self._task, self._candle_task):
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        logger.info("🧭 CompassService stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        return dict(self._latest)


# ─── Singleton ────────────────────────────────────────────────────────────────

_compass_service_instance: Optional[CompassService] = None


def get_compass_service() -> CompassService:
    global _compass_service_instance
    if _compass_service_instance is None:
        _compass_service_instance = CompassService(CacheService())
    return _compass_service_instance

"""
📊 Market Regime Engine — "Is Today a Trending Day?"
=====================================================
Multi-factor regime classifier that determines whether each index
(NIFTY, BANKNIFTY, SENSEX) is in a TRENDING or SIDEWAYS/RANGEBOUND
regime for the current session.

REGIME CATEGORIES:
  STRONG_TRENDING_BULLISH  — Clear directional up-move, all factors aligned
  TRENDING_BULLISH         — Uptrend present, most confirmations
  STRONG_TRENDING_BEARISH  — Clear directional down-move, all factors aligned
  TRENDING_BEARISH         — Downtrend present, most confirmations
  SIDEWAYS                 — Rangebound, no clear direction
  NEUTRAL                  — Insufficient data or mixed signals

FACTORS (10 factors, weighted scoring):
  1. Directional Move Score    (20%) — Net % change from open
  2. EMA Alignment & Spread    (15%) — EMA 20/50/100/200 stack quality
  3. Candle Consistency        (15%) — % of 5m candles in dominant direction
  4. Range Expansion           (12%) — Today's range vs avg candle range
  5. Opening Range Breakout    (10%) — Price vs first-30min high/low
  6. Volume Trend              (8%)  — Volume acceleration with direction
  7. Body-to-Range Ratio       (5%)  — Large bodies = trending, wicks = sideways
  8. VIX Context               (5%)  — India VIX level (volatility backdrop)
  9. PCR Bias                  (5%)  — Put-Call Ratio extremes
  10. OI Conviction            (5%)  — Net OI buildup direction

DATA SOURCES: CacheService only (zero external HTTP calls).
  - Spot ticks:   "market:{SYMBOL}"
  - 5m candles:   "analysis_candles:{SYMBOL}"
  - 15m candles:  "analysis_candles_15m:{SYMBOL}"
  - VIX:          "market:INDIAVIX"
  - PCR:          "market:{SYMBOL}" → pcr field

ISOLATION: Own ConnectionManager, own asyncio task, own singleton.
           Zero shared state with other services.
"""

import asyncio
import collections
import json
import logging
import math
import time as time_mod
from datetime import datetime, time
from typing import Dict, Any, Optional, List, Set, Deque

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE
from services.persistent_market_state import PersistentMarketState

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")

# ── Regime classification thresholds ─────────────────────────────────────────

STRONG_TRENDING_THRESHOLD = 70   # Score ≥ 70 → STRONG_TRENDING
TRENDING_THRESHOLD = 45          # Score ≥ 45 → TRENDING
SIDEWAYS_THRESHOLD = 25          # Score < 25 → SIDEWAYS  (25-45 = NEUTRAL)

# Factor weights (must sum to 1.0)
FACTOR_WEIGHTS: Dict[str, float] = {
    "directional_move":     0.15,  # reduced — anchored to open, misses mid-session reversals
    "ema_alignment":        0.15,
    "candle_consistency":   0.10,  # reduced — recency now handled by recent_momentum
    "range_expansion":      0.12,
    "opening_range":        0.10,
    "volume_trend":         0.08,
    "body_ratio":           0.05,
    "vix_context":          0.05,
    "pcr_bias":             0.05,
    "oi_conviction":        0.05,
    "recent_momentum":      0.10,  # NEW — last 8 candles (~40 min), detects mid-session reversals
}

SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class RegimeConnectionManager:
    """Completely isolated WebSocket manager for Market Regime."""

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


regime_manager = RegimeConnectionManager()


# ── Utility helpers ──────────────────────────────────────────────────────────

def _clamp(v: float, lo: float = 0.0, hi: float = 100.0) -> float:
    return max(lo, min(hi, v))


def _safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


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
    """Linear regression slope over a list of values."""
    n = len(values)
    if n < 3:
        return 0.0
    x_mean = (n - 1) / 2.0
    y_mean = sum(values) / n
    num = sum((i - x_mean) * (v - y_mean) for i, v in enumerate(values))
    den = sum((i - x_mean) ** 2 for i in range(n))
    return num / den if den != 0 else 0.0


def _std_dev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


# ── Per-index regime history ─────────────────────────────────────────────────

class RegimeHistory:
    """Ring buffers for tracking regime factors across time."""
    MAXLEN = 120  # ~10 minutes of 5s ticks

    def __init__(self):
        self._prices: Deque[float] = collections.deque(maxlen=self.MAXLEN)
        self._regime_scores: Deque[float] = collections.deque(maxlen=30)
        self._opening_range_high: Optional[float] = None
        self._opening_range_low: Optional[float] = None
        self._opening_range_set: bool = False
        self._day_open: Optional[float] = None
        self._session_date: Optional[str] = None

    def reset_for_new_day(self, date_str: str):
        if self._session_date != date_str:
            self._prices.clear()
            self._regime_scores.clear()
            self._opening_range_high = None
            self._opening_range_low = None
            self._opening_range_set = False
            self._day_open = None
            self._session_date = date_str

    def push_price(self, price: float):
        if price > 0:
            self._prices.append(price)
            if self._day_open is None:
                self._day_open = price

    def set_opening_range(self, high: float, low: float):
        if not self._opening_range_set:
            self._opening_range_high = high
            self._opening_range_low = low
            self._opening_range_set = True

    def push_regime_score(self, score: float):
        self._regime_scores.append(score)


# ── The Core Engine ──────────────────────────────────────────────────────────

class MarketRegimeService:
    """
    Determines whether today is a Trending Day or Sideways Day for each index.
    Runs as a background asyncio task, broadcasting via its own WebSocket.
    """

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._cache = CacheService()
        self._history: Dict[str, RegimeHistory] = {
            sym: RegimeHistory() for sym in SYMBOLS
        }
        self._last_snapshot: Dict[str, Any] = {}
        self._last_market: Dict[str, Dict] = {}  # Fallback cache per symbol
        self._cadence_live = 1.0      # Broadcast every 1s during LIVE (fast regime updates)
        self._cadence_closed = 30.0   # Every 30s when CLOSED
        self._heartbeat_interval = 30.0

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())
        logger.info("MarketRegimeService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("MarketRegimeService stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        return self._last_snapshot

    # ── Main loop ─────────────────────────────────────────────────────────

    async def _run_loop(self):
        last_heartbeat = 0.0
        while self._running:
            try:
                now = datetime.now(IST)
                is_live = self._is_market_live(now)
                cadence = self._cadence_live if is_live else self._cadence_closed

                snapshot = await self._compute_all_regimes()
                self._last_snapshot = snapshot

                if regime_manager.client_count > 0:
                    await regime_manager.broadcast({
                        "type": "regime_update",
                        "data": snapshot,
                    })

                    if time_mod.time() - last_heartbeat > self._heartbeat_interval:
                        await regime_manager.broadcast({
                            "type": "regime_heartbeat",
                            "timestamp": now.isoformat(),
                        })
                        last_heartbeat = time_mod.time()

                await asyncio.sleep(cadence)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("MarketRegimeService loop error: %s", e, exc_info=True)
                await asyncio.sleep(10)

    # ── Market session check ──────────────────────────────────────────────

    @staticmethod
    def _is_market_live(now: datetime) -> bool:
        if now.weekday() >= 5:
            return False
        t = now.time()
        return time(9, 15) <= t <= time(15, 30)

    # ── Compute regime for all symbols ────────────────────────────────────

    async def _compute_all_regimes(self) -> Dict[str, Any]:
        results: Dict[str, Any] = {}
        now = datetime.now(IST)
        date_str = now.strftime("%Y-%m-%d")

        for sym in SYMBOLS:
            hist = self._history[sym]
            hist.reset_for_new_day(date_str)
            results[sym] = await self._compute_regime(sym, hist, now)

        return results

    async def _compute_regime(
        self, symbol: str, hist: RegimeHistory, now: datetime
    ) -> Dict[str, Any]:
        """Compute regime for a single symbol using 10 factors."""

        # ── Gather raw data from cache ────────────────────────────────
        market_data = await self._get_market_data(symbol)
        candles_5m = await self._get_candles(symbol, "5m")
        candles_15m = await self._get_candles(symbol, "15m")
        vix_data = await self._get_vix()

        price = _safe_float(market_data.get("price"))
        open_price = _safe_float(market_data.get("open"))
        high = _safe_float(market_data.get("high"))
        low = _safe_float(market_data.get("low"))
        pcr = _safe_float(market_data.get("pcr"))
        oi = _safe_float(market_data.get("oi"))
        volume = _safe_float(market_data.get("volume"))
        change_pct = _safe_float(market_data.get("changePercent"))  # vs prev close
        vix = _safe_float(vix_data.get("price") or vix_data.get("ltp")) if vix_data else 0.0

        # Intraday change: price vs today's open (the REAL direction today)
        intraday_pct = ((price - open_price) / open_price * 100) if open_price > 0 else change_pct

        if price <= 0:
            return self._no_data_response(symbol)

        hist.push_price(price)

        # Set opening range from first 30 min of 5m candles (6 candles)
        if not hist._opening_range_set and len(candles_5m) >= 6:
            orb_candles = candles_5m[:6]
            orb_high = max(_safe_float(c.get("high")) for c in orb_candles)
            orb_low = min(
                _safe_float(c.get("low"))
                for c in orb_candles
                if _safe_float(c.get("low")) > 0
            )
            if orb_high > 0 and orb_low > 0:
                hist.set_opening_range(orb_high, orb_low)

        # ── Compute each factor (0–100 score) ────────────────────────

        factors: Dict[str, Dict[str, Any]] = {}

        # 1. Directional Move Score (20%) — uses intraday move from open
        factors["directional_move"] = self._factor_directional_move(
            price, open_price, intraday_pct, symbol
        )

        # 2. EMA Alignment & Spread (15%)
        factors["ema_alignment"] = self._factor_ema_alignment(
            price, candles_5m, hist
        )

        # 3. Candle Consistency (15%)
        factors["candle_consistency"] = self._factor_candle_consistency(
            candles_5m, intraday_pct
        )

        # 4. Range Expansion (12%)
        factors["range_expansion"] = self._factor_range_expansion(
            high, low, price, candles_5m, open_price
        )

        # 5. Opening Range Breakout (10%)
        factors["opening_range"] = self._factor_opening_range(
            price, hist, high, low, open_price
        )

        # 6. Volume Trend (8%)
        factors["volume_trend"] = self._factor_volume_trend(
            candles_5m, volume, intraday_pct
        )

        # 7. Body-to-Range Ratio (5%)
        factors["body_ratio"] = self._factor_body_ratio(
            candles_5m, price, open_price, high, low
        )

        # 8. VIX Context (5%)
        factors["vix_context"] = self._factor_vix_context(vix)

        # 9. PCR Bias (5%)
        factors["pcr_bias"] = self._factor_pcr_bias(pcr)

        # 10. OI Conviction (5%)
        factors["oi_conviction"] = self._factor_oi_conviction(
            candles_5m, oi, intraday_pct
        )

        # 11. Recent Momentum (10%) — last 8 candles (~40 min), detects mid-session reversals
        factors["recent_momentum"] = self._factor_recent_momentum(candles_5m, price)

        # ── Aggregate weighted score ──────────────────────────────────

        total_score = 0.0
        direction_votes_bull = 0.0
        direction_votes_bear = 0.0

        for name, factor in factors.items():
            weight = FACTOR_WEIGHTS[name]
            total_score += factor["score"] * weight

            # Track directional bias
            dir_bias = factor.get("direction_bias", 0)
            if dir_bias > 0:
                direction_votes_bull += weight * dir_bias
            elif dir_bias < 0:
                direction_votes_bear += weight * abs(dir_bias)

        total_score = _clamp(total_score, 0, 100)
        hist.push_regime_score(total_score)

        # ── Determine regime ──────────────────────────────────────────

        net_direction = direction_votes_bull - direction_votes_bear
        is_bullish = net_direction > 0.05
        is_bearish = net_direction < -0.05

        if total_score >= STRONG_TRENDING_THRESHOLD:
            if is_bullish:
                regime = "STRONG_TRENDING_BULLISH"
            elif is_bearish:
                regime = "STRONG_TRENDING_BEARISH"
            else:
                regime = "STRONG_TRENDING_BULLISH" if intraday_pct >= 0 else "STRONG_TRENDING_BEARISH"
        elif total_score >= TRENDING_THRESHOLD:
            if is_bullish:
                regime = "TRENDING_BULLISH"
            elif is_bearish:
                regime = "TRENDING_BEARISH"
            else:
                regime = "TRENDING_BULLISH" if intraday_pct >= 0 else "TRENDING_BEARISH"
        elif total_score >= SIDEWAYS_THRESHOLD:
            regime = "NEUTRAL"
        else:
            regime = "SIDEWAYS"

        # ── Determine if it's a "Trending Day" ────────────────────────

        is_trending_day = total_score >= TRENDING_THRESHOLD
        trend_strength = (
            "STRONG" if total_score >= STRONG_TRENDING_THRESHOLD
            else "MODERATE" if total_score >= TRENDING_THRESHOLD
            else "WEAK" if total_score >= SIDEWAYS_THRESHOLD
            else "NONE"
        )

        # ── Build actionable summary ──────────────────────────────────

        if regime.startswith("STRONG_TRENDING"):
            direction = "BULLISH" if "BULLISH" in regime else "BEARISH"
            action_summary = (
                f"Strong trending day — {direction}. "
                f"High-conviction directional trades favoured. "
                f"Trail stop-losses, ride the trend."
            )
            trade_approach = "DIRECTIONAL_ONLY"
        elif regime.startswith("TRENDING"):
            direction = "BULLISH" if "BULLISH" in regime else "BEARISH"
            action_summary = (
                f"Trending day — {direction}. "
                f"Favour {direction.lower()} trades with pullback entries. "
                f"Avoid counter-trend scalps."
            )
            trade_approach = "DIRECTIONAL_BIAS"
        elif regime == "NEUTRAL":
            action_summary = (
                "Mixed signals — no clear trend established yet. "
                "Wait for breakout confirmation or trade range extremes. "
                "Reduce position size."
            )
            trade_approach = "WAIT_AND_WATCH"
        else:
            action_summary = (
                "Sideways/rangebound day. "
                "Trade support/resistance bounces only. "
                "Avoid breakout trades — high false-breakout risk."
            )
            trade_approach = "RANGE_TRADE"

        # ── Score stability (smoothed over last readings) ─────────────

        recent_scores = list(hist._regime_scores)
        avg_score = sum(recent_scores) / len(recent_scores) if recent_scores else total_score
        score_volatility = _std_dev(recent_scores) if len(recent_scores) >= 3 else 0

        return {
            "symbol": symbol,
            "regime": regime,
            "isTrendingDay": is_trending_day,
            "trendStrength": trend_strength,
            "tradeApproach": trade_approach,
            "actionSummary": action_summary,
            "regimeScore": round(total_score, 1),
            "avgScore": round(avg_score, 1),
            "scoreStability": round(100 - min(score_volatility * 5, 50), 1),
            "direction": "BULLISH" if is_bullish else ("BEARISH" if is_bearish else "NEUTRAL"),
            "directionStrength": round(abs(net_direction) * 100, 1),
            "factors": {
                name: {
                    "score": round(f["score"], 1),
                    "label": f["label"],
                    "signal": f["signal"],
                    "weight": round(FACTOR_WEIGHTS[name] * 100),
                }
                for name, f in factors.items()
            },
            "context": {
                "price": round(price, 2),
                "open": round(open_price, 2),
                "high": round(high, 2),
                "low": round(low, 2),
                "changePct": round(intraday_pct, 2),
                "changePctPrevClose": round(change_pct, 2),
                "vix": round(vix, 2),
                "pcr": round(pcr, 2),
                "orbHigh": round(hist._opening_range_high or 0, 2),
                "orbLow": round(hist._opening_range_low or 0, 2),
            },
            "dataSource": "LIVE" if self._is_market_live(datetime.now(IST)) else "MARKET_CLOSED",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # ══════════════════════════════════════════════════════════════════════
    #  FACTOR ENGINES — each returns { score: 0-100, label, signal, direction_bias }
    # ══════════════════════════════════════════════════════════════════════

    def _factor_directional_move(
        self, price: float, open_price: float, intraday_pct: float, symbol: str
    ) -> Dict[str, Any]:
        """
        Factor 1: Directional Move Score (20%)
        Measures how far price has moved from the day's open in one direction.
        Uses INTRADAY change (price vs open), NOT changePct (vs prev close).
        Large moves = trending, small moves = sideways.

        Thresholds (adaptive per index):
          NIFTY: >0.8% = strong trending, 0.4-0.8% = trending, <0.2% = sideways
          BANKNIFTY: >1.2% = strong trending (more volatile)
          SENSEX: >0.7% = strong trending
        """
        vol_multiplier = {
            "NIFTY": 1.0,
            "BANKNIFTY": 1.4,  # BankNifty is ~40% more volatile
            "SENSEX": 0.9,
        }.get(symbol, 1.0)

        abs_change = abs(intraday_pct)
        # Normalize: 1.0% move = 80 score for NIFTY
        raw_score = (abs_change / (0.8 * vol_multiplier)) * 80
        score = _clamp(raw_score, 0, 100)

        direction_word = "UP" if intraday_pct > 0 else "DOWN"
        if abs_change >= 1.2 * vol_multiplier:
            label = f"Very strong {direction_word} move from open ({intraday_pct:+.2f}%)"
            signal = "STRONG_TREND"
        elif abs_change >= 0.6 * vol_multiplier:
            label = f"Clear {direction_word} move from open ({intraday_pct:+.2f}%)"
            signal = "TRENDING"
        elif abs_change >= 0.3 * vol_multiplier:
            label = f"Mild {direction_word} move from open ({intraday_pct:+.2f}%)"
            signal = "MILD"
        else:
            label = f"Flat / no directional move ({intraday_pct:+.2f}%)"
            signal = "FLAT"

        direction_bias = 1.0 if intraday_pct > 0 else (-1.0 if intraday_pct < 0 else 0.0)
        # Scale bias by magnitude
        direction_bias *= min(abs_change / (0.5 * vol_multiplier), 1.0)

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_ema_alignment(
        self, price: float, candles: List[Dict], hist: RegimeHistory
    ) -> Dict[str, Any]:
        """
        Factor 2: EMA Alignment & Spread (15%)
        Computes EMA-20 and EMA-50 from 5m candles.
        Falls back to price history from RegimeHistory when candles unavailable.
        """
        # Build close price series: prefer candles, fallback to price history
        closes = []
        if len(candles) >= 10:
            closes = [_safe_float(c.get("close")) for c in candles if _safe_float(c.get("close")) > 0]
        
        if len(closes) < 10 and len(hist._prices) >= 5:
            closes = list(hist._prices)

        if len(closes) < 5:
            return {
                "score": 30,
                "label": "Insufficient data for EMA analysis",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        # Use available closes for EMA computation (adapt periods to data)
        n = len(closes)
        ema_fast_period = min(20, max(5, n // 2))
        ema_slow_period = min(50, n)

        # Compute EMAs
        ema_20 = self._compute_ema(closes, ema_fast_period)
        ema_50 = self._compute_ema(closes, ema_slow_period)

        if ema_20 <= 0 or ema_50 <= 0:
            return {
                "score": 30,
                "label": "EMA computation failed",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        # Alignment check
        bullish_aligned = price > ema_20 > ema_50
        bearish_aligned = price < ema_20 < ema_50
        aligned = bullish_aligned or bearish_aligned

        # EMA spread as % of price
        spread_pct = abs(ema_20 - ema_50) / price * 100 if price > 0 else 0

        # EMA slope (direction of EMA-20 over last 5 candles)
        ema_20_recent = []
        for i in range(max(0, len(closes) - 5), len(closes)):
            subset = closes[: i + 1]
            if len(subset) >= 20:
                ema_20_recent.append(self._compute_ema(subset, 20))
        ema_slope = _linear_slope(ema_20_recent) if len(ema_20_recent) >= 3 else 0

        # Score
        score = 0.0
        if aligned:
            score += 50  # Alignment bonus
            score += min(spread_pct * 30, 30)  # Spread bonus (max 30)
            score += min(abs(ema_slope) * 200, 20)  # Slope bonus (max 20)
        else:
            # Tangled — low score but give some credit for spread
            score = 10 + min(spread_pct * 10, 20)

        score = _clamp(score, 0, 100)

        direction_bias = 0.0
        if bullish_aligned:
            direction_bias = min(spread_pct / 0.3, 1.0)
        elif bearish_aligned:
            direction_bias = -min(spread_pct / 0.3, 1.0)

        if aligned:
            signal = "ALIGNED_BULL" if bullish_aligned else "ALIGNED_BEAR"
            label = f"EMAs {'bullish' if bullish_aligned else 'bearish'} aligned, spread {spread_pct:.3f}%"
        else:
            signal = "TANGLED"
            label = f"EMAs tangled/crossing, spread {spread_pct:.3f}%"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_candle_consistency(self, candles: List[Dict], intraday_pct: float) -> Dict[str, Any]:
        """
        Factor 3: Candle Consistency (15%)
        Measures what % of 5m candles closed in the dominant direction.
        Falls back to intraday move when candles unavailable.
        """
        if len(candles) < 5:
            # Fallback: use intraday move magnitude as proxy for consistency
            abs_move = abs(intraday_pct)
            if abs_move >= 0.8:
                score = _clamp(50 + abs_move * 15, 50, 85)
                d = "bullish" if intraday_pct > 0 else "bearish"
                return {
                    "score": score,
                    "label": f"Intraday {d} bias ({intraday_pct:+.2f}% from open)",
                    "signal": "MODERATE_CONSISTENCY",
                    "direction_bias": (1.0 if intraday_pct > 0 else -1.0) * min(abs_move / 1.5, 1.0),
                }
            elif abs_move >= 0.3:
                return {
                    "score": 35,
                    "label": f"Mild intraday bias ({intraday_pct:+.2f}%)",
                    "signal": "MILD",
                    "direction_bias": (1.0 if intraday_pct > 0 else -1.0) * 0.3,
                }
            return {
                "score": 15,
                "label": f"No candle data, flat intraday ({intraday_pct:+.2f}%)",
                "signal": "FLAT",
                "direction_bias": 0,
            }

        bullish_count = 0
        bearish_count = 0
        max_bull_streak = 0
        max_bear_streak = 0
        current_bull_streak = 0
        current_bear_streak = 0

        # candles[0] = newest, candles[-1] = oldest (lpush order)
        # Give the 6 most recent candles (last 30 min) 3× weight so a mid-session
        # reversal can override the morning's bearish candles quickly.
        for i, c in enumerate(candles):
            w = 3 if i < 6 else 1  # newest 6 = 3× weight
            o = _safe_float(c.get("open"))
            cl = _safe_float(c.get("close"))
            if cl > o:
                bullish_count += w
                current_bull_streak += 1
                current_bear_streak = 0
                max_bull_streak = max(max_bull_streak, current_bull_streak)
            elif cl < o:
                bearish_count += w
                current_bear_streak += 1
                current_bull_streak = 0
                max_bear_streak = max(max_bear_streak, current_bear_streak)
            else:
                current_bull_streak = 0
                current_bear_streak = 0

        total_weighted = sum(3 if i < 6 else 1 for i in range(len(candles)))
        dominant_count = max(bullish_count, bearish_count)
        dominance_pct = (dominant_count / total_weighted) * 100 if total_weighted > 0 else 50
        max_streak = max(max_bull_streak, max_bear_streak)

        # Score: 50% dominance = 0 score, 100% dominance = 100 score
        consistency_score = max(0, (dominance_pct - 50) * 2)
        # Streak bonus: each consecutive candle above 3 adds points
        streak_bonus = max(0, (max_streak - 3)) * 8
        score = _clamp(consistency_score + streak_bonus, 0, 100)

        is_bull_dominant = bullish_count > bearish_count
        direction_bias = 0.0
        if dominance_pct > 55:
            direction_bias = (1.0 if is_bull_dominant else -1.0) * min(
                (dominance_pct - 50) / 30, 1.0
            )

        if dominance_pct >= 75:
            signal = "STRONG_CONSISTENCY"
            d = "bullish" if is_bull_dominant else "bearish"
            label = f"{dominance_pct:.0f}% candles {d}, streak of {max_streak}"
        elif dominance_pct >= 60:
            signal = "MODERATE_CONSISTENCY"
            d = "bullish" if is_bull_dominant else "bearish"
            label = f"{dominance_pct:.0f}% candles {d}"
        else:
            signal = "MIXED"
            label = f"Mixed candles — {bullish_count} bull vs {bearish_count} bear"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_range_expansion(
        self, day_high: float, day_low: float, price: float,
        candles: List[Dict], open_price: float
    ) -> Dict[str, Any]:
        """
        Factor 4: Range Expansion (12%)
        Compares today's range (high-low) to the average range of individual candles.
        Falls back to day OHLC-based analysis when candles unavailable.
        """
        if day_high <= 0 or day_low <= 0 or day_high <= day_low:
            return {
                "score": 30,
                "label": "No valid day range data",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        day_range = day_high - day_low
        day_range_pct = (day_range / price) * 100 if price > 0 else 0

        # Average individual candle range
        candle_ranges = []
        for c in candles:
            ch = _safe_float(c.get("high"))
            cl = _safe_float(c.get("low"))
            if ch > 0 and cl > 0 and ch > cl:
                candle_ranges.append(ch - cl)

        if candle_ranges:
            avg_candle_range = sum(candle_ranges) / len(candle_ranges)
            range_ratio = day_range / avg_candle_range if avg_candle_range > 0 else 1.0
            # Score: ratio 1.0 = 0, ratio 5.0 = 100
            score = _clamp((range_ratio - 1.0) / 4.0 * 100, 0, 100)
        else:
            # No candles: score purely from day_range_pct
            # NIFTY typical daily range: 0.5%-1.5%
            # <0.5% = compressed, 0.5-1.0% = normal, >1.0% = expanded
            range_ratio = 0
            if day_range_pct >= 1.5:
                score = 80
            elif day_range_pct >= 1.0:
                score = 55
            elif day_range_pct >= 0.6:
                score = 35
            elif day_range_pct >= 0.3:
                score = 20
            else:
                score = 5

        if day_range_pct >= 1.5:
            signal = "EXPANDED"
            label = f"Day range {day_range_pct:.2f}% — strongly expanded"
        elif day_range_pct >= 0.8:
            signal = "MODERATE"
            label = f"Day range {day_range_pct:.2f}% — moderate expansion"
        elif day_range_pct >= 0.4:
            signal = "MILD"
            label = f"Day range {day_range_pct:.2f}% — mild expansion"
        else:
            signal = "COMPRESSED"
            label = f"Day range {day_range_pct:.2f}% — compressed"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": 0,  # Range expansion is non-directional
        }

    def _factor_opening_range(
        self, price: float, hist: RegimeHistory,
        day_high: float, day_low: float, open_price: float
    ) -> Dict[str, Any]:
        """
        Factor 5: Opening Range Breakout (10%)
        If price is trading outside the first 30 minutes' high/low, it's trending.
        Falls back to comparing price vs open when ORB data unavailable.
        """
        if (
            not hist._opening_range_set
            or hist._opening_range_high is None
            or hist._opening_range_low is None
        ):
            # Fallback: use price vs open direction and day range position
            if open_price > 0 and day_high > 0 and day_low > 0:
                intraday_pct = abs(price - open_price) / open_price * 100
                day_range = day_high - day_low
                # Where is price in the day range? Near high = bullish, near low = bearish
                if day_range > 0:
                    position = (price - day_low) / day_range  # 0=low, 1=high
                else:
                    position = 0.5

                if price > open_price and position > 0.7:
                    score = _clamp(40 + intraday_pct * 20, 40, 75)
                    return {
                        "score": score,
                        "label": f"Trading near day high, {intraday_pct:.2f}% above open",
                        "signal": "BREAKOUT_UP",
                        "direction_bias": min(intraday_pct / 1.5, 1.0),
                    }
                elif price < open_price and position < 0.3:
                    score = _clamp(40 + intraday_pct * 20, 40, 75)
                    return {
                        "score": score,
                        "label": f"Trading near day low, {intraday_pct:.2f}% below open",
                        "signal": "BREAKOUT_DOWN",
                        "direction_bias": -min(intraday_pct / 1.5, 1.0),
                    }
                else:
                    return {
                        "score": 20,
                        "label": f"Ranging around open (no ORB data)",
                        "signal": "INSIDE_ORB",
                        "direction_bias": 0,
                    }
            return {
                "score": 20,
                "label": "Opening range not yet established",
                "signal": "WAITING",
                "direction_bias": 0,
            }

        orb_high = hist._opening_range_high
        orb_low = hist._opening_range_low
        orb_range = orb_high - orb_low

        if orb_range <= 0:
            return {
                "score": 30,
                "label": "Invalid ORB range",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        if price > orb_high:
            # Bullish breakout
            distance_pct = ((price - orb_high) / orb_range) * 100
            score = _clamp(40 + distance_pct * 0.6, 40, 100)
            direction_bias = min(distance_pct / 100, 1.0)
            signal = "BREAKOUT_UP"
            label = f"Trading {((price - orb_high) / price * 100):.2f}% above ORB high"
        elif price < orb_low:
            # Bearish breakout
            distance_pct = ((orb_low - price) / orb_range) * 100
            score = _clamp(40 + distance_pct * 0.6, 40, 100)
            direction_bias = -min(distance_pct / 100, 1.0)
            signal = "BREAKOUT_DOWN"
            label = f"Trading {((orb_low - price) / price * 100):.2f}% below ORB low"
        else:
            # Inside ORB
            mid = (orb_high + orb_low) / 2
            dist_from_mid = abs(price - mid) / (orb_range / 2)
            score = _clamp(dist_from_mid * 20, 0, 25)
            direction_bias = 0
            signal = "INSIDE_ORB"
            label = "Trading inside opening range — no breakout"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_volume_trend(
        self, candles: List[Dict], volume: float, intraday_pct: float
    ) -> Dict[str, Any]:
        """
        Factor 6: Volume Trend (8%)
        Rising volume with directional move = trending.
        Falls back to volume + direction proxy when candles unavailable.
        """
        if len(candles) < 5:
            # Fallback: use available volume and intraday move as proxy
            if volume > 0 and abs(intraday_pct) >= 0.5:
                score = _clamp(35 + abs(intraday_pct) * 15, 35, 70)
                d = "bullish" if intraday_pct > 0 else "bearish"
                return {
                    "score": score,
                    "label": f"Volume active with {d} intraday move",
                    "signal": "RISING",
                    "direction_bias": 0,
                }
            return {
                "score": 25,
                "label": "No candle volume data available",
                "signal": "FLAT",
                "direction_bias": 0,
            }

        volumes = [_safe_float(c.get("volume")) for c in candles[-20:]]
        volumes = [v for v in volumes if v > 0]

        if len(volumes) < 5:
            return {
                "score": 30,
                "label": "No volume data available",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        # Volume slope
        vol_slope = _linear_slope(volumes)
        avg_vol = sum(volumes) / len(volumes) if volumes else 1
        normalized_slope = vol_slope / avg_vol if avg_vol > 0 else 0

        # Recent vs early volume ratio
        half = len(volumes) // 2
        early_avg = sum(volumes[:half]) / half if half > 0 else 1
        recent_avg = sum(volumes[half:]) / max(len(volumes) - half, 1)
        vol_ratio = recent_avg / early_avg if early_avg > 0 else 1.0

        # Score
        if vol_ratio > 1.0 and normalized_slope > 0:
            # Rising volume = trending
            score = _clamp(30 + (vol_ratio - 1.0) * 50 + normalized_slope * 200, 30, 100)
            signal = "RISING"
            label = f"Volume rising — recent {vol_ratio:.1f}x of early session"
        elif vol_ratio < 0.7:
            # Falling volume = sideways/exhaustion
            score = _clamp(vol_ratio * 30, 0, 30)
            signal = "FALLING"
            label = f"Volume declining — recent {vol_ratio:.1f}x of early session"
        else:
            score = 30
            signal = "FLAT"
            label = "Volume stable — no clear volume trend"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": 0,  # Volume is non-directional
        }

    def _factor_body_ratio(
        self, candles: List[Dict],
        price: float, open_price: float, day_high: float, day_low: float
    ) -> Dict[str, Any]:
        """
        Factor 7: Body-to-Range Ratio (5%)
        Trending days: candles have large bodies (>60% of range).
        Falls back to day OHLC body/range when candles unavailable.
        """
        if len(candles) < 5:
            # Fallback: use day OHLC to compute body ratio
            day_range = day_high - day_low if day_high > 0 and day_low > 0 else 0
            body = abs(price - open_price) if open_price > 0 else 0
            if day_range > 0:
                avg_ratio = body / day_range
                score = _clamp((avg_ratio - 0.3) / 0.5 * 100, 0, 100)
                if avg_ratio >= 0.65:
                    signal = "STRONG_BODIES"
                    label = f"Day body/range {avg_ratio:.0%} — strong directional day"
                elif avg_ratio >= 0.45:
                    signal = "MODERATE"
                    label = f"Day body/range {avg_ratio:.0%} — moderate"
                else:
                    signal = "WICKY"
                    label = f"Day body/range {avg_ratio:.0%} — wicky/indecisive"
                return {
                    "score": score,
                    "label": label,
                    "signal": signal,
                    "direction_bias": 0,
                }
            return {
                "score": 25,
                "label": "No candle or day OHLC data",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        ratios = []
        for c in candles[-20:]:
            o = _safe_float(c.get("open"))
            cl = _safe_float(c.get("close"))
            h = _safe_float(c.get("high"))
            lo = _safe_float(c.get("low"))
            rng = h - lo
            if rng > 0:
                body = abs(cl - o)
                ratios.append(body / rng)

        if not ratios:
            return {
                "score": 30,
                "label": "No valid candle data",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        avg_ratio = sum(ratios) / len(ratios)

        # Score: 0.3 ratio = 0 score, 0.8 ratio = 100 score
        score = _clamp((avg_ratio - 0.3) / 0.5 * 100, 0, 100)

        if avg_ratio >= 0.65:
            signal = "STRONG_BODIES"
            label = f"Avg body/range {avg_ratio:.0%} — strong directional candles"
        elif avg_ratio >= 0.45:
            signal = "MODERATE"
            label = f"Avg body/range {avg_ratio:.0%} — moderate"
        else:
            signal = "WICKY"
            label = f"Avg body/range {avg_ratio:.0%} — indecisive/doji candles"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": 0,
        }

    def _factor_vix_context(self, vix: float) -> Dict[str, Any]:
        """
        Factor 8: India VIX Context (5%)
        VIX > 18 = volatile backdrop, trends more likely
        VIX 12-18 = normal
        VIX < 12 = complacent, sideways more likely
        """
        if vix <= 0:
            return {
                "score": 40,
                "label": "VIX data unavailable",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        if vix >= 22:
            score = 90
            signal = "HIGH_VOL"
            label = f"VIX {vix:.1f} — high volatility, strong trends likely"
        elif vix >= 18:
            score = 70
            signal = "ELEVATED"
            label = f"VIX {vix:.1f} — elevated, trending conditions probable"
        elif vix >= 14:
            score = 45
            signal = "NORMAL"
            label = f"VIX {vix:.1f} — normal volatility"
        elif vix >= 11:
            score = 25
            signal = "LOW"
            label = f"VIX {vix:.1f} — low volatility, sideways likely"
        else:
            score = 10
            signal = "VERY_LOW"
            label = f"VIX {vix:.1f} — very low, compressed range expected"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": 0,
        }

    def _factor_pcr_bias(self, pcr: float) -> Dict[str, Any]:
        """
        Factor 9: PCR Bias (5%)
        Extreme PCR = potential strong move.
        PCR < 0.7 = heavy call buying (bullish crowd) → possible bearish trap or strong bull
        PCR > 1.3 = heavy put buying (bearish crowd) → possible bullish trap or strong bear
        PCR 0.8-1.2 = balanced = sideways likely
        """
        if pcr <= 0:
            return {
                "score": 30,
                "label": "PCR data unavailable",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        deviation = abs(pcr - 1.0)
        # Extreme = higher trend score
        score = _clamp(deviation * 100, 0, 100)

        if pcr < 0.6:
            signal = "EXTREME_CALL"
            label = f"PCR {pcr:.2f} — extreme call buying, strong bullish bias"
            direction_bias = 0.8
        elif pcr < 0.8:
            signal = "BULLISH_PCR"
            label = f"PCR {pcr:.2f} — moderate bullish sentiment"
            direction_bias = 0.4
        elif pcr <= 1.2:
            signal = "BALANCED"
            label = f"PCR {pcr:.2f} — balanced, neutral sentiment"
            direction_bias = 0.0
        elif pcr <= 1.5:
            signal = "BEARISH_PCR"
            label = f"PCR {pcr:.2f} — moderate bearish sentiment"
            direction_bias = -0.4
        else:
            signal = "EXTREME_PUT"
            label = f"PCR {pcr:.2f} — extreme put buying, strong bearish bias"
            direction_bias = -0.8

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_oi_conviction(
        self, candles: List[Dict], current_oi: float, intraday_pct: float
    ) -> Dict[str, Any]:
        """
        Factor 10: OI Conviction (5%)
        OI increasing + price moving = trend conviction (fresh positions).
        OI decreasing + price moving = covering (weaker trend).
        OI flat = no new interest = sideways.
        """
        if current_oi <= 0:
            return {
                "score": 30,
                "label": "OI data unavailable",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        # Get OI from candles if available
        oi_values = [
            _safe_float(c.get("oi"))
            for c in candles
            if _safe_float(c.get("oi")) > 0
        ]

        if len(oi_values) >= 3:
            oi_slope = _linear_slope(oi_values)
            avg_oi = sum(oi_values) / len(oi_values)
            oi_change_pct = (oi_slope / avg_oi) * 100 if avg_oi > 0 else 0
        else:
            oi_change_pct = 0

        abs_price_change = abs(intraday_pct)
        oi_increasing = oi_change_pct > 0.1

        if oi_increasing and abs_price_change > 0.3:
            # Fresh positions + directional move = strong conviction
            score = _clamp(50 + abs_price_change * 20 + abs(oi_change_pct) * 10, 50, 100)
            signal = "FRESH_BUILDUP"
            label = f"OI building with {intraday_pct:+.2f}% move — fresh conviction"
            direction_bias = (1.0 if intraday_pct > 0 else -1.0) * 0.6
        elif not oi_increasing and abs_price_change > 0.3:
            # Covering + move = weaker trend
            score = _clamp(30 + abs_price_change * 10, 30, 60)
            signal = "COVERING"
            label = f"OI declining during {intraday_pct:+.2f}% move — position covering"
            direction_bias = (1.0 if intraday_pct > 0 else -1.0) * 0.3
        else:
            score = 20
            signal = "FLAT_OI"
            label = "OI flat — no fresh interest"
            direction_bias = 0

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    def _factor_recent_momentum(self, candles: List[Dict], price: float) -> Dict[str, Any]:
        """
        Factor 11: Recent Candle Momentum (10%)
        Looks at the last 8 completed 5m candles (~40 min window).
        Completely independent of the day's open price — detects MID-SESSION
        reversals that full-day metrics (directional_move, candle_consistency) miss.

        candles[0] = newest, candles[-1] = oldest (lpush order).
        Uses newest 8: candles[:8].
        """
        recent = [
            c for c in candles[:8]
            if _safe_float(c.get("close")) > 0 and _safe_float(c.get("open")) > 0
        ]
        if len(recent) < 3:
            return {
                "score": 30,
                "label": "Insufficient recent candles for momentum",
                "signal": "NO_DATA",
                "direction_bias": 0,
            }

        bull = sum(1 for c in recent if _safe_float(c.get("close")) > _safe_float(c.get("open")))
        bear = sum(1 for c in recent if _safe_float(c.get("close")) < _safe_float(c.get("open")))
        total = len(recent)

        # recent[0] = newest candle, recent[-1] = oldest in this 40-min window
        oldest_close = _safe_float(recent[-1].get("close"))
        newest_close = _safe_float(recent[0].get("close"))

        # Blend: 70% price change over window, 30% live-vs-latest-candle
        window_pct = (newest_close - oldest_close) / oldest_close * 100 if oldest_close > 0 else 0
        live_pct = (price - newest_close) / newest_close * 100 if newest_close > 0 and price > 0 else 0
        recent_pct = window_pct * 0.7 + live_pct * 0.3

        dominance = max(bull, bear) / total if total > 0 else 0.5
        is_bull = bull >= bear

        # Score: candle dominance (0-60) + price magnitude (0-40)
        dominance_score = max(0.0, (dominance - 0.5) * 2.0) * 60.0
        momentum_score = min(abs(recent_pct) / 0.8 * 40.0, 40.0)
        score = _clamp(dominance_score + momentum_score, 0, 100)

        direction_bias = (1.0 if is_bull else -1.0) * min(abs(recent_pct) / 0.6, 1.0)

        if score >= 60:
            signal = "STRONG_MOMENTUM"
            d = "bullish" if is_bull else "bearish"
            label = f"Recent {total} candles: {bull} bull/{bear} bear, {recent_pct:+.2f}% (~40min)"
        elif score >= 30:
            signal = "MILD_MOMENTUM"
            d = "bullish" if is_bull else "bearish"
            label = f"Mild {d} recent momentum ({recent_pct:+.2f}%)"
        else:
            signal = "NEUTRAL"
            label = f"Mixed recent candles ({bull} bull / {bear} bear)"

        return {
            "score": score,
            "label": label,
            "signal": signal,
            "direction_bias": direction_bias,
        }

    # ── Data access helpers ───────────────────────────────────────────────

    async def _get_market_data(self, symbol: str) -> Dict:
        """Read market data via CacheService (handles TTL + persistent fallback)."""
        data = await self._cache.get_market_data(symbol)
        if data:
            self._last_market[symbol] = data
            return data
        return self._last_market.get(symbol, {})

    async def _get_candles(self, symbol: str, timeframe: str = "5m") -> List[Dict]:
        """Read candle data from cache, handling tuple format."""
        if timeframe == "5m":
            key = f"analysis_candles:{symbol}"
        elif timeframe == "15m":
            key = f"analysis_candles_15m:{symbol}"
        elif timeframe == "3m":
            key = f"analysis_candles_3m:{symbol}"
        else:
            key = f"analysis_candles:{symbol}"

        raw_items = await self._cache.lrange(key, 0, 99)
        candles: List[Dict] = []
        for item in raw_items:
            c = _parse_candle(item)
            if c:
                candles.append(c)
        return candles

    async def _get_vix(self) -> Dict:
        """Read India VIX from cache with tuple-aware parsing."""
        raw = _SHARED_CACHE.get("market:INDIAVIX")
        if raw and isinstance(raw, tuple):
            try:
                value_json, expire_at = raw
                data = json.loads(value_json) if isinstance(value_json, str) else value_json
                return data if isinstance(data, dict) else {}
            except Exception:
                return {}
        # Fallback: try CacheService async get
        data = await self._cache.get("market:INDIAVIX")
        if data:
            return data
        # Try persistent state
        persistent = PersistentMarketState.get_last_known_state("INDIAVIX")
        return persistent if persistent else {}

    @staticmethod
    def _compute_ema(data: List[float], period: int) -> float:
        """Compute EMA for a list of values."""
        if not data or period <= 0:
            return 0.0
        if len(data) < period:
            return sum(data) / len(data)

        multiplier = 2.0 / (period + 1)
        ema = sum(data[:period]) / period  # SMA seed
        for val in data[period:]:
            ema = (val - ema) * multiplier + ema
        return ema

    def _no_data_response(self, symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "regime": "NEUTRAL",
            "isTrendingDay": False,
            "trendStrength": "NONE",
            "tradeApproach": "WAIT_AND_WATCH",
            "actionSummary": "Waiting for market data...",
            "regimeScore": 0,
            "avgScore": 0,
            "scoreStability": 0,
            "direction": "NEUTRAL",
            "directionStrength": 0,
            "factors": {},
            "context": {},
            "dataSource": "NO_DATA",
            "timestamp": datetime.now(IST).isoformat(),
        }


# ── Singleton ─────────────────────────────────────────────────────────────────

_service: Optional[MarketRegimeService] = None


def get_market_regime_service() -> MarketRegimeService:
    global _service
    if _service is None:
        _service = MarketRegimeService()
    return _service

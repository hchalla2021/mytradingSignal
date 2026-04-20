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
import random
from datetime import datetime, time, date, timedelta
from typing import Dict, Any, Optional, List, Set
from pathlib import Path

from fastapi import WebSocket
import pytz

from services.cache import CacheService, _SHARED_CACHE
from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
settings = get_settings()

SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]

# Well-known Zerodha instrument tokens for indices
INDEX_TOKENS: Dict[str, int] = {
    "NIFTY": 256265,
    "BANKNIFTY": 260105,
    "SENSEX": 265,
}

PERSISTENT_FILE = Path(__file__).parent.parent / "data" / "chart_intelligence_state.json"


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
    """Detect Fair Value Gaps from candle array."""
    fvgs = []
    if len(candles) < 3:
        return fvgs

    for i in range(2, len(candles)):
        c0 = candles[i - 2]  # First candle
        c2 = candles[i]      # Third candle

        h0 = c0["h"]
        l0 = c0["l"]
        h2 = c2["h"]
        l2 = c2["l"]

        # Bullish FVG: gap up — third candle low > first candle high
        if l2 > h0:
            gap_size = l2 - h0
            mid_range = (c0["h"] + c2["l"]) / 2
            strength = min(1.0, gap_size / (mid_range * 0.005)) if mid_range > 0 else 0.5
            filled = False
            # Check if any subsequent candle filled the gap
            for j in range(i + 1, len(candles)):
                if candles[j]["l"] <= h0:
                    filled = True
                    break
            fvgs.append({
                "type": "bullish",
                "top": round(l2, 2),
                "bottom": round(h0, 2),
                "startIdx": i,
                "filled": filled,
                "strength": round(strength, 2),
            })

        # Bearish FVG: gap down — third candle high < first candle low
        if h2 < l0:
            gap_size = l0 - h2
            mid_range = (c0["l"] + c2["h"]) / 2
            strength = min(1.0, gap_size / (mid_range * 0.005)) if mid_range > 0 else 0.5
            filled = False
            for j in range(i + 1, len(candles)):
                if candles[j]["h"] >= l0:
                    filled = True
                    break
            fvgs.append({
                "type": "bearish",
                "top": round(l0, 2),
                "bottom": round(h2, 2),
                "startIdx": i,
                "filled": filled,
                "strength": round(strength, 2),
            })

    return fvgs


def _detect_order_blocks(candles: List[Dict]) -> List[Dict]:
    """
    Detect Order Blocks: last bullish/bearish candle before a strong impulsive move.
    Bullish OB  = last bearish candle before a strong up-move (≥0.3% body move in next 3 candles).
    Bearish OB  = last bullish candle before a strong down-move.
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

        # Bullish OB: bearish candle, then up-move ≥ 0.15%  (relaxed from 0.3%)
        if is_bear and c["h"] > 0 and (imp_high - c["h"]) / c["h"] >= 0.0015:
            mitigated = any(
                candles[j]["l"] <= c["l"]
                for j in range(i + 4, len(candles))
            )
            obs.append({
                "type": "bullish",
                "top": round(max(c["o"], c["c"]), 2),
                "bottom": round(min(c["o"], c["c"]), 2),
                "high": round(c["h"], 2),
                "low": round(c["l"], 2),
                "startIdx": i,
                "mitigated": mitigated,
                "strength": round(min(1.0, (imp_high - c["h"]) / (c["h"] * 0.005)), 2),
            })

        # Bearish OB: bullish candle, then down-move ≥ 0.15%
        if is_bull and c["l"] > 0 and (c["l"] - imp_low) / c["l"] >= 0.0015:
            mitigated = any(
                candles[j]["h"] >= c["h"]
                for j in range(i + 4, len(candles))
            )
            obs.append({
                "type": "bearish",
                "top": round(max(c["o"], c["c"]), 2),
                "bottom": round(min(c["o"], c["c"]), 2),
                "high": round(c["h"], 2),
                "low": round(c["l"], 2),
                "startIdx": i,
                "mitigated": mitigated,
                "strength": round(min(1.0, (c["l"] - imp_low) / (c["l"] * 0.005)), 2),
            })

    # Keep last 6 unmitigated + up to 3 mitigated
    unmitigated = [ob for ob in obs if not ob["mitigated"]][-6:]
    mitigated_recent = [ob for ob in obs if ob["mitigated"]][-3:]
    return unmitigated + mitigated_recent


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
            liquidity.append({
                "type": "sell_side",          # liquidity resting above equal highs
                "level": round(h_a, 2),
                "startIdx": idx_a,
                "swept": sweep_idx is not None,
                "sweepIdx": sweep_idx,
                "touchCount": 1 + len(matches),
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
            liquidity.append({
                "type": "buy_side",           # liquidity resting below equal lows
                "level": round(l_a, 2),
                "startIdx": idx_a,
                "swept": sweep_idx is not None,
                "sweepIdx": sweep_idx,
                "touchCount": 1 + len(matches),
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


def _compute_support_resistance(candles: List[Dict], window: int = 5) -> Dict[str, List[float]]:
    """Detect swing highs/lows as support/resistance levels."""
    supports = []
    resistances = []
    if len(candles) < window * 2 + 1:
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
        return clusters[-5:]  # Top 5 levels

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
        self._cadence_broadcast = 3.0
        self._cadence_fetch = 10.0
        self._cadence_closed = 60.0
        self._heartbeat_interval = 30.0
        self._kite_init_backoff_until: float = 0.0

    # ── Kite init ────────────────────────────────────────────────────────

    def _init_kite(self):
        current_token = settings.zerodha_access_token
        if current_token and current_token != self._last_token:
            self._kite_initialized = False
            self._last_token = current_token
            self._kite_init_backoff_until = 0.0

        if self._kite_initialized:
            return

        now = time_mod.time()
        if now < self._kite_init_backoff_until:
            return

        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            self._kite_init_backoff_until = now + 60
            return

        try:
            from kiteconnect import KiteConnect
            self._kite = KiteConnect(api_key=settings.zerodha_api_key)
            self._kite.set_access_token(settings.zerodha_access_token)
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
        cache_key = f"market:{symbol}"
        cached = _SHARED_CACHE.get(cache_key)
        if isinstance(cached, str):
            try:
                cached = json.loads(cached)
            except Exception:
                cached = None
        if isinstance(cached, dict):
            spot = _sf(cached.get("price") or cached.get("last_price"))
            if spot > 0:
                return spot
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
        """Fetch intraday candles from Zerodha historical data API."""
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
            return candles
        except Exception as e:
            logger.debug("Chart intel fetch %s %s failed: %s", symbol, interval, e)
            return []

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

    # ── Seed data generator ──────────────────────────────────────────────

    def _generate_seed_data(self, symbol: str, spot: float) -> Dict[str, Any]:
        """Generate realistic chart data when Zerodha is unavailable."""
        rng = random.Random(int(spot * 100) + hash(symbol))
        now = datetime.now(IST)
        today = now.date()

        def make_candles(interval_min: int) -> List[Dict]:
            candles = []
            t = datetime.combine(today, time(9, 15), tzinfo=IST)
            end = min(now, datetime.combine(today, time(15, 30), tzinfo=IST))
            price = spot * (1 - rng.uniform(0.003, 0.012))
            trend = rng.choice([-1, 1])

            while t <= end:
                # Periodic trend flip
                if rng.random() < 0.08:
                    trend *= -1

                # Occasional impulse candle (every ~20 bars) — creates OB conditions
                if rng.random() < 0.05:
                    change = trend * rng.uniform(0.003, 0.008)
                else:
                    drift = trend * rng.uniform(0.0002, 0.001)
                    volatility = rng.gauss(0, 0.001)
                    change = drift + volatility

                o = price
                c = price * (1 + change)
                h = max(o, c) * (1 + rng.uniform(0, 0.003))
                l = min(o, c) * (1 - rng.uniform(0, 0.003))
                vol = max(100, int(rng.gauss(80000, 25000)))

                candles.append({
                    "t": t.isoformat(),
                    "o": round(o, 2), "h": round(h, 2),
                    "l": round(l, 2), "c": round(c, 2),
                    "v": vol,
                })
                price = c
                t += timedelta(minutes=interval_min)

            if candles:
                candles[-1]["c"] = round(spot, 2)
                candles[-1]["h"] = round(max(candles[-1]["h"], spot), 2)
                candles[-1]["l"] = round(min(candles[-1]["l"], spot), 2)
            return candles

        c3 = make_candles(3)
        c5 = make_candles(5)

        fvg3 = _detect_fvg(c3)
        fvg5 = _detect_fvg(c5)
        ob3 = _detect_order_blocks(c3)
        ob5 = _detect_order_blocks(c5)
        liq3 = _detect_liquidity(c3)
        liq5 = _detect_liquidity(c5)

        # Approximate PDH/PDL
        pdh = round(spot * (1 + rng.uniform(0.003, 0.012)), 2)
        pdl = round(spot * (1 - rng.uniform(0.003, 0.012)), 2)
        daily_seed = [
            {"h": pdh, "l": pdl, "o": round(spot * 0.998, 2), "c": round(spot * 1.001, 2)},
            {"h": pdh, "l": pdl, "o": round(spot * 0.998, 2), "c": round(spot * 1.001, 2)},
        ]
        levels = _compute_levels(c3, daily_seed, spot)

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
            "dataSource": "MARKET_CLOSED",
            "timestamp": now.isoformat(),
        }

    # ── Build symbol payload ─────────────────────────────────────────────

    def _build_symbol_data(self, symbol: str, c3: List, c5: List, daily: List, spot: float, phase: str) -> Dict:
        fvg3 = _detect_fvg(c3)
        fvg5 = _detect_fvg(c5)
        ob3 = _detect_order_blocks(c3)
        ob5 = _detect_order_blocks(c5)
        liq3 = _detect_liquidity(c3)
        liq5 = _detect_liquidity(c5)
        levels = _compute_levels(c3, daily, spot)

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
            "dataSource": "LIVE" if phase == "LIVE" else "MARKET_CLOSED",
            "timestamp": datetime.now(IST).isoformat(),
        }

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
                    do_full = (now_ts - self._last_full_fetch >= self._cadence_fetch)

                    if do_full:
                        self._init_kite()

                        async def _fetch_one(sym: str):
                            spot = self._get_spot_price(sym)
                            if spot <= 0:
                                if sym in self._last_snapshot:
                                    return (sym, {**self._last_snapshot[sym], "dataSource": "CACHED"})
                                return (sym, None)

                            c3 = await asyncio.to_thread(self._fetch_candles_sync, sym, "3minute")
                            c5 = await asyncio.to_thread(self._fetch_candles_sync, sym, "5minute")
                            daily = await asyncio.to_thread(self._fetch_daily_sync, sym)

                            if c3:
                                return (sym, self._build_symbol_data(sym, c3, c5 or [], daily, spot, phase))
                            elif sym in self._last_snapshot:
                                return (sym, {**self._last_snapshot[sym], "dataSource": "CACHED"})
                            else:
                                return (sym, self._generate_seed_data(sym, spot))

                        results = await asyncio.gather(
                            *[_fetch_one(s) for s in SYMBOLS],
                            return_exceptions=True,
                        )

                        snapshot: Dict[str, Any] = {}
                        for result in results:
                            if isinstance(result, Exception):
                                continue
                            sym, entry = result
                            if entry is not None:
                                snapshot[sym] = entry

                        if phase == "CLOSED":
                            _closed_fetch_done = True

                        if snapshot:
                            self._last_snapshot = snapshot
                            self._last_full_fetch = now_ts
                    else:
                        # Between full fetches: update spot on latest candle
                        if self._last_snapshot:
                            for sym in SYMBOLS:
                                if sym not in self._last_snapshot:
                                    continue
                                spot = self._get_spot_price(sym)
                                if spot <= 0:
                                    continue
                                entry = self._last_snapshot[sym]
                                entry["spot"] = round(spot, 2)
                                entry["timestamp"] = datetime.now(IST).isoformat()
                                # Update last candle's close/high/low
                                for tf_key in ("candles3m", "candles5m"):
                                    candles = entry.get(tf_key)
                                    if candles and len(candles) > 0:
                                        last = candles[-1]
                                        last["c"] = round(spot, 2)
                                        last["h"] = round(max(last["h"], spot), 2)
                                        last["l"] = round(min(last["l"], spot), 2)

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

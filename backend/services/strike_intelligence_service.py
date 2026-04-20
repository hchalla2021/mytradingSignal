"""
🎯 Strike Intelligence Engine
==============================
Per-strike option chain analysis for NIFTY/BANKNIFTY/SENSEX.
Computes ATM ± 5 strikes with PE/CE volume, OI, price action,
liquidity scoring → STRONG_BUY / BUY / NEUTRAL / SELL / STRONG_SELL.

DATA SOURCE: Zerodha instruments cache + quote API (via PCRService pattern).
             Reads spot price from CacheService ("market:{SYMBOL}").
             Zero impact on other services — fully isolated.

PERSISTENCE: Stores last snapshot to disk so data survives market close.
             On restart / closed market, serves cached data.

CADENCE:     Live market  → every 5s
             Closed       → every 60s (serve cached)

ISOLATION: Own ConnectionManager, own asyncio task, own singleton.
"""

import asyncio
import json
import logging
import math
import time as time_mod
from datetime import datetime, time, date
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

# Strike step sizes per index
STRIKE_STEP: Dict[str, int] = {
    "NIFTY": 50,
    "BANKNIFTY": 100,
    "SENSEX": 100,
}

NUM_STRIKES_EACH_SIDE = 5  # ATM ± 5

# Persistent file
PERSISTENT_FILE = Path(__file__).parent.parent / "data" / "strike_intelligence_state.json"


# ── Isolated WebSocket manager ───────────────────────────────────────────────

class StrikeIntelConnectionManager:
    """Completely isolated WebSocket manager for Strike Intelligence."""

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


strike_intel_manager = StrikeIntelConnectionManager()


# ── Helpers ──────────────────────────────────────────────────────────────────

def _safe_float(v, default: float = 0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _safe_int(v, default: int = 0) -> int:
    try:
        return int(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _get_atm_strike(spot: float, step: int) -> int:
    """Round spot price to nearest strike (standard half-up, not banker's rounding)."""
    return int(spot / step + 0.5) * step


def _compute_signal(
    ce_oi: int, pe_oi: int, ce_volume: int, pe_volume: int,
    ce_price: float, pe_price: float, ce_change: float, pe_change: float,
    spot: float, strike: int,
) -> Dict[str, Any]:
    """
    Compute buy/sell signal for a single strike from CE & PE data.

    Scoring factors (weighted):
      1. Volume imbalance     (30%) — Which side has more volume
      2. OI imbalance         (25%) — OI buildup direction
      3. Price momentum       (20%) — Premium change indicates direction
      4. Liquidity depth      (15%) — Total volume+OI as liquidity indicator
      5. Moneyness bias       (10%) — ITM vs OTM preference

    Returns signal for CE side and PE side independently.
    """
    total_oi = ce_oi + pe_oi
    total_vol = ce_volume + pe_volume

    # ── CE Signal ────────────────────────────────────────────────────────
    ce_score = 0.0

    # 1. Volume dominance (30%)
    if total_vol > 0:
        ce_vol_ratio = ce_volume / total_vol
        # If CE volume > 50%, calls are being bought → bullish for CE
        ce_score += (ce_vol_ratio - 0.5) * 2.0 * 30  # -30 to +30

    # 2. OI imbalance (25%)
    if total_oi > 0:
        ce_oi_ratio = ce_oi / total_oi
        # High CE OI relative to PE = resistance (bearish for CE buyers)
        # Low CE OI = room to run (bullish for CE buyers)
        ce_score += (0.5 - ce_oi_ratio) * 2.0 * 25  # Inverted: less CE OI = bullish

    # 3. Price momentum (20%)
    if ce_price > 0:
        ce_pct_change = (ce_change / ce_price) * 100 if ce_price > 0 else 0
        ce_score += _clamp(ce_pct_change * 4, -20, 20)

    # 4. Liquidity depth (15%)
    if total_vol > 100:
        liq_score = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)  # Normalize
        ce_score += liq_score * 15 if ce_volume > pe_volume else -liq_score * 5

    # 5. Moneyness (10%) — ITM calls are more actionable
    if spot > 0:
        moneyness = (spot - strike) / spot * 100
        if moneyness > 0:  # ITM call
            ce_score += min(moneyness * 2, 10)
        else:  # OTM call
            ce_score += max(moneyness * 1.5, -10)

    # ── PE Signal ────────────────────────────────────────────────────────
    pe_score = 0.0

    # 1. Volume dominance (30%)
    if total_vol > 0:
        pe_vol_ratio = pe_volume / total_vol
        pe_score += (pe_vol_ratio - 0.5) * 2.0 * 30

    # 2. OI imbalance (25%)
    if total_oi > 0:
        pe_oi_ratio = pe_oi / total_oi
        pe_score += (0.5 - pe_oi_ratio) * 2.0 * 25

    # 3. Price momentum (20%)
    if pe_price > 0:
        pe_pct_change = (pe_change / pe_price) * 100 if pe_price > 0 else 0
        pe_score += _clamp(pe_pct_change * 4, -20, 20)

    # 4. Liquidity depth (15%)
    if total_vol > 100:
        liq_score = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)
        pe_score += liq_score * 15 if pe_volume > ce_volume else -liq_score * 5

    # 5. Moneyness (10%) — ITM puts are more actionable
    if spot > 0:
        moneyness = (strike - spot) / spot * 100
        if moneyness > 0:  # ITM put
            pe_score += min(moneyness * 2, 10)
        else:  # OTM put
            pe_score += max(moneyness * 1.5, -10)

    def _score_to_signal(score: float) -> str:
        if score >= 40:
            return "STRONG_BUY"
        elif score >= 15:
            return "BUY"
        elif score <= -40:
            return "STRONG_SELL"
        elif score <= -15:
            return "SELL"
        return "NEUTRAL"

    def _score_to_pct(score: float) -> Dict[str, float]:
        """Convert raw score to buy/sell percentage breakdown."""
        clamped = _clamp(score, -100, 100)
        if clamped >= 0:
            buy_pct = min(50 + clamped * 0.5, 100)
            sell_pct = 100 - buy_pct
        else:
            sell_pct = min(50 + abs(clamped) * 0.5, 100)
            buy_pct = 100 - sell_pct
        neutral_pct = max(0, 30 - abs(clamped) * 0.3)
        # Normalize
        total = buy_pct + sell_pct + neutral_pct
        return {
            "buyPct": round(buy_pct / total * 100, 1),
            "sellPct": round(sell_pct / total * 100, 1),
            "neutralPct": round(neutral_pct / total * 100, 1),
        }

    return {
        "ce": {
            "signal": _score_to_signal(ce_score),
            "score": round(ce_score, 1),
            "breakdown": _score_to_pct(ce_score),
            "oi": ce_oi,
            "volume": ce_volume,
            "price": round(ce_price, 2),
            "change": round(ce_change, 2),
        },
        "pe": {
            "signal": _score_to_signal(pe_score),
            "score": round(pe_score, 1),
            "breakdown": _score_to_pct(pe_score),
            "oi": pe_oi,
            "volume": pe_volume,
            "price": round(pe_price, 2),
            "change": round(pe_change, 2),
        },
    }


# ── Persistence ──────────────────────────────────────────────────────────────

def _load_persistent() -> Dict[str, Any]:
    try:
        if PERSISTENT_FILE.exists():
            with open(PERSISTENT_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.debug("Could not load strike intel state: %s", e)
    return {}


def _save_persistent(state: Dict[str, Any]):
    try:
        PERSISTENT_FILE.parent.mkdir(parents=True, exist_ok=True)
        with open(PERSISTENT_FILE, "w") as f:
            json.dump(state, f, default=str)
    except Exception as e:
        logger.debug("Could not save strike intel state: %s", e)


# ── Core Service ─────────────────────────────────────────────────────────────

class StrikeIntelligenceService:
    """
    Fetches per-strike CE/PE data for ATM ± 5 strikes,
    computes buy/sell signals, broadcasts via WebSocket.
    """

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._cache = CacheService()
        self._kite = None
        self._kite_initialized = False
        self._last_token: Optional[str] = None
        self._last_snapshot: Dict[str, Any] = {}
        self._instruments_cache: Dict[str, List] = {}
        self._instruments_cache_date: Dict[str, date] = {}
        self._last_save_time: float = 0.0
        self._cadence_live = 3.0        # Fast updates during market hours
        self._cadence_closed = 60.0
        self._heartbeat_interval = 30.0
        self._kite_init_backoff_until: float = 0.0  # Backoff timer for failed init

    # ── KiteConnect init ─────────────────────────────────────────────────

    def _init_kite(self):
        current_token = settings.zerodha_access_token
        if current_token and current_token != self._last_token:
            self._kite_initialized = False
            self._last_token = current_token
            self._kite_init_backoff_until = 0.0  # New token → reset backoff

        if self._kite_initialized:
            return

        # Backoff: don't retry init if we recently failed
        now = time_mod.time()
        if now < self._kite_init_backoff_until:
            return

        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            self._kite_init_backoff_until = now + 60  # Check again in 60s
            return

        try:
            from kiteconnect import KiteConnect
            self._kite = KiteConnect(api_key=settings.zerodha_api_key)
            self._kite.set_access_token(settings.zerodha_access_token)
            try:
                self._kite.profile()
                self._kite_initialized = True
                self._kite_init_backoff_until = 0.0
                logger.info("Strike Intelligence: KiteConnect initialized")
            except Exception as e:
                logger.warning("Strike Intelligence: Token validation failed: %s", e)
                self._kite = None
                self._kite_initialized = False
                self._kite_init_backoff_until = now + 30  # Retry in 30s
        except Exception as e:
            logger.warning("Strike Intelligence: KiteConnect init error: %s", e)
            self._kite = None
            self._kite_initialized = False
            self._kite_init_backoff_until = now + 30

    def _get_instruments(self, exchange: str) -> List:
        today = datetime.now(IST).date()
        if exchange in self._instruments_cache and exchange in self._instruments_cache_date:
            if self._instruments_cache_date[exchange] == today:
                return self._instruments_cache[exchange]

        if not self._kite:
            return []

        instruments = self._kite.instruments(exchange)
        self._instruments_cache[exchange] = instruments
        self._instruments_cache_date[exchange] = today
        return instruments

    # ── Lifecycle ─────────────────────────────────────────────────────────

    async def start(self):
        if self._running:
            return
        self._running = True
        # Load persistent data
        persisted = _load_persistent()
        if persisted:
            self._last_snapshot = persisted
        self._task = asyncio.create_task(self._run_loop())
        logger.info("StrikeIntelligenceService started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        # Save final state
        if self._last_snapshot:
            await asyncio.to_thread(_save_persistent, self._last_snapshot)
        logger.info("StrikeIntelligenceService stopped")

    def get_snapshot(self) -> Dict[str, Any]:
        if not self._last_snapshot:
            # Try loading from disk if not yet populated
            persisted = _load_persistent()
            if persisted:
                # Mark as MARKET_CLOSED since we loaded from disk
                for sym in persisted:
                    if isinstance(persisted[sym], dict):
                        persisted[sym]["dataSource"] = "MARKET_CLOSED"
                self._last_snapshot = persisted
        return self._last_snapshot

    # ── Market phase detection ───────────────────────────────────────────

    def _get_market_phase(self) -> str:
        now = datetime.now(IST)
        wd = now.weekday()
        if wd >= 5:
            return "CLOSED"
        t = now.time()
        if time(9, 15) <= t <= time(15, 30):
            return "LIVE"
        if time(9, 0) <= t < time(9, 15):
            return "PRE_OPEN"
        return "CLOSED"

    def _get_spot_price(self, symbol: str) -> float:
        """Get spot price from cache, falling back to persistent market state."""
        # Try in-memory cache first — _SHARED_CACHE stores (json_str, expire_at) tuples
        cache_key = f"market:{symbol}"
        raw = _SHARED_CACHE.get(cache_key)
        if raw is not None:
            try:
                value_json, expire_at = raw
                if time_mod.time() < expire_at:
                    data = json.loads(value_json)
                    spot = _safe_float(data.get("price") or data.get("last_price"))
                    if spot > 0:
                        return spot
            except Exception:
                pass

        # Fallback: persistent market state file
        try:
            from services.persistent_market_state import PersistentMarketState
            state = PersistentMarketState.get_state(symbol)
            if state:
                spot = _safe_float(state.get("price") or state.get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass

        # Fallback: read persistent file directly
        try:
            pfile = Path(__file__).parent.parent / "data" / "persistent_market_state.json"
            if pfile.exists():
                with open(pfile, "r") as f:
                    pdata = json.load(f)
                sym_data = pdata.get(symbol, {})
                spot = _safe_float(sym_data.get("price") or sym_data.get("last_price"))
                if spot > 0:
                    return spot
        except Exception:
            pass

        return 0.0

    # ── Fetch strike data for one symbol ─────────────────────────────────

    def _fetch_strikes_sync(self, symbol: str, spot: float) -> Optional[Dict[str, Any]]:
        """Blocking call — fetch option chain quotes for ATM ± 5 strikes."""
        if not self._kite:
            return None

        index_config = {
            "NIFTY": {"name": "NIFTY", "exchange": "NFO"},
            "BANKNIFTY": {"name": "BANKNIFTY", "exchange": "NFO"},
            "SENSEX": {"name": "SENSEX", "exchange": "BFO"},
        }
        config = index_config.get(symbol)
        if not config:
            return None

        step = STRIKE_STEP[symbol]
        atm = _get_atm_strike(spot, step)
        strikes = [atm + i * step for i in range(-NUM_STRIKES_EACH_SIDE, NUM_STRIKES_EACH_SIDE + 1)]

        try:
            instruments = self._get_instruments(config["exchange"])
        except Exception as e:
            logger.debug("Instrument fetch failed for %s: %s", symbol, e)
            return None

        if not instruments:
            return None

        today = datetime.now(IST).date()
        ce_map: Dict[int, Dict] = {}
        pe_map: Dict[int, Dict] = {}

        for inst in instruments:
            if inst.get("name") != config["name"]:
                continue
            if inst.get("instrument_type") not in ("CE", "PE"):
                continue
            expiry = inst.get("expiry")
            if not expiry or expiry < today:
                continue
            strike_val = inst.get("strike")
            if strike_val not in strikes:
                continue
            if inst["instrument_type"] == "CE":
                if strike_val not in ce_map or inst["expiry"] < ce_map[strike_val]["expiry"]:
                    ce_map[strike_val] = inst
            else:
                if strike_val not in pe_map or inst["expiry"] < pe_map[strike_val]["expiry"]:
                    pe_map[strike_val] = inst

        # Collect tokens
        tokens_map: Dict[str, Dict] = {}  # token_str -> {type, strike, inst}
        for s in strikes:
            if s in ce_map:
                tk = str(ce_map[s]["instrument_token"])
                tokens_map[tk] = {"type": "CE", "strike": s, "inst": ce_map[s]}
            if s in pe_map:
                tk = str(pe_map[s]["instrument_token"])
                tokens_map[tk] = {"type": "PE", "strike": s, "inst": pe_map[s]}

        if not tokens_map:
            return None

        try:
            quotes = self._kite.quote(list(tokens_map.keys()))
        except Exception as e:
            logger.debug("Quote fetch failed for %s: %s", symbol, e)
            return None

        # Build per-strike data
        strike_data: Dict[int, Dict] = {}
        for s in strikes:
            strike_data[s] = {
                "ce_oi": 0, "pe_oi": 0,
                "ce_volume": 0, "pe_volume": 0,
                "ce_price": 0.0, "pe_price": 0.0,
                "ce_change": 0.0, "pe_change": 0.0,
            }

        for tk_str, meta in tokens_map.items():
            q = quotes.get(tk_str, {})
            s = meta["strike"]
            prefix = "ce" if meta["type"] == "CE" else "pe"
            strike_data[s][f"{prefix}_oi"] = _safe_int(q.get("oi"))
            strike_data[s][f"{prefix}_volume"] = _safe_int(q.get("volume"))
            strike_data[s][f"{prefix}_price"] = _safe_float(q.get("last_price"))
            ohlc = q.get("ohlc", {})
            close_price = _safe_float(ohlc.get("close"))
            ltp = _safe_float(q.get("last_price"))
            strike_data[s][f"{prefix}_change"] = round(ltp - close_price, 2) if close_price > 0 else 0.0

        # Get nearest expiry for display
        expiry_str = ""
        for s in strikes:
            if s in ce_map:
                expiry_str = str(ce_map[s].get("expiry", ""))
                break

        return {
            "atm": atm,
            "step": step,
            "spot": round(spot, 2),
            "expiry": expiry_str,
            "strikes": strike_data,
        }

    # ── Compute signals for all strikes ──────────────────────────────────

    def _build_symbol_data(self, symbol: str, raw: Dict[str, Any]) -> Dict[str, Any]:
        """Transform raw strike data into the full signal payload."""
        spot = raw["spot"]
        atm = raw["atm"]
        step = raw["step"]
        strikes_raw = raw["strikes"]

        strikes_out = []
        for strike_val in sorted(strikes_raw.keys()):
            sd = strikes_raw[strike_val]
            signals = _compute_signal(
                ce_oi=sd["ce_oi"], pe_oi=sd["pe_oi"],
                ce_volume=sd["ce_volume"], pe_volume=sd["pe_volume"],
                ce_price=sd["ce_price"], pe_price=sd["pe_price"],
                ce_change=sd["ce_change"], pe_change=sd["pe_change"],
                spot=spot, strike=strike_val,
            )

            # Determine strike label
            diff = strike_val - atm
            if diff == 0:
                label = "ATM"
            elif diff > 0:
                label = f"OTM+{diff // step}"
            else:
                label = f"ITM{diff // step}"

            strikes_out.append({
                "strike": strike_val,
                "label": label,
                "isATM": strike_val == atm,
                "ce": signals["ce"],
                "pe": signals["pe"],
            })

        return {
            "symbol": symbol,
            "spot": spot,
            "atm": atm,
            "step": step,
            "expiry": raw.get("expiry", ""),
            "strikeCount": len(strikes_out),
            "strikes": strikes_out,
            "dataSource": "LIVE",
            "timestamp": datetime.now(IST).isoformat(),
        }

    # ── Seed data generator ────────────────────────────────────────────

    def _generate_seed_data(self, symbol: str, spot: float) -> Dict[str, Any]:
        """
        Generate realistic strike intelligence data from spot price alone.
        Used when Zerodha data is unavailable (market closed, no auth, etc.).
        """
        import random
        rng = random.Random(int(spot * 100) + hash(symbol))  # Deterministic per spot+symbol

        step = STRIKE_STEP[symbol]
        atm = _get_atm_strike(spot, step)
        strikes = [atm + i * step for i in range(-NUM_STRIKES_EACH_SIDE, NUM_STRIKES_EACH_SIDE + 1)]

        strike_data: Dict[int, Dict] = {}
        for s in strikes:
            dist = abs(s - atm) / step
            # ATM gets highest volume/OI, decays outward
            base_oi = int(rng.gauss(500000, 100000) * max(0.3, 1.0 - dist * 0.15))
            base_vol = int(rng.gauss(200000, 50000) * max(0.2, 1.0 - dist * 0.18))

            # CE premium higher for ITM calls, PE premium higher for ITM puts
            ce_intrinsic = max(0, spot - s)
            pe_intrinsic = max(0, s - spot)
            ce_price = round(ce_intrinsic + rng.uniform(5, 80) * max(0.2, 1.0 - dist * 0.12), 2)
            pe_price = round(pe_intrinsic + rng.uniform(5, 80) * max(0.2, 1.0 - dist * 0.12), 2)

            ce_oi = max(100, base_oi + rng.randint(-50000, 50000))
            pe_oi = max(100, base_oi + rng.randint(-50000, 50000))
            ce_vol = max(10, base_vol + rng.randint(-30000, 30000))
            pe_vol = max(10, base_vol + rng.randint(-30000, 30000))

            strike_data[s] = {
                "ce_oi": ce_oi, "pe_oi": pe_oi,
                "ce_volume": ce_vol, "pe_volume": pe_vol,
                "ce_price": ce_price, "pe_price": pe_price,
                "ce_change": round(rng.uniform(-5, 5), 2),
                "pe_change": round(rng.uniform(-5, 5), 2),
            }

        raw = {
            "atm": atm, "step": step, "spot": round(spot, 2),
            "expiry": "", "strikes": strike_data,
        }
        data = self._build_symbol_data(symbol, raw)
        data["dataSource"] = "MARKET_CLOSED"
        return data

    # ── Main loop ────────────────────────────────────────────────────────

    async def _run_loop(self):
        last_heartbeat = 0.0
        _closed_fetch_done = False  # Only fetch once during CLOSED to seed data

        while self._running:
            try:
                phase = self._get_market_phase()
                cadence = self._cadence_live if phase == "LIVE" else self._cadence_closed
                now_ts = time_mod.time()

                # Reset closed fetch flag when market opens
                if phase == "LIVE":
                    _closed_fetch_done = False

                need_fetch = (
                    phase in ("LIVE", "PRE_OPEN")
                    or (phase == "CLOSED" and not self._last_snapshot and not _closed_fetch_done)
                )

                if need_fetch:
                    self._init_kite()

                    # Fetch all symbols in PARALLEL for minimum latency
                    async def _fetch_one(symbol: str) -> tuple:
                        try:
                            spot = self._get_spot_price(symbol)
                            if spot <= 0:
                                if symbol in self._last_snapshot:
                                    entry = {**self._last_snapshot[symbol], "dataSource": "CACHED"}
                                    return (symbol, entry)
                                return (symbol, None)

                            raw = await asyncio.to_thread(
                                self._fetch_strikes_sync, symbol, spot
                            )
                            if raw:
                                data = self._build_symbol_data(symbol, raw)
                                if phase == "CLOSED":
                                    data["dataSource"] = "MARKET_CLOSED"
                                return (symbol, data)
                            elif symbol in self._last_snapshot:
                                entry = {**self._last_snapshot[symbol], "dataSource": "CACHED"}
                                return (symbol, entry)
                            else:
                                # No real data available — return None, do NOT show fake seed data
                                logger.debug("No real strike data for %s, skipping seed", symbol)
                                return (symbol, None)

                        except Exception as e:
                            logger.debug("Strike intel error for %s: %s", symbol, e)
                            if symbol in self._last_snapshot:
                                entry = {**self._last_snapshot[symbol], "dataSource": "CACHED"}
                                return (symbol, entry)
                            return (symbol, None)

                    results = await asyncio.gather(
                        *[_fetch_one(sym) for sym in SYMBOLS],
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
                        await strike_intel_manager.broadcast({
                            "type": "strike_intel_update",
                            "data": snapshot,
                        })

                        # Debounced persist (every 30s)
                        if now_ts - self._last_save_time > 30:
                            self._last_save_time = now_ts
                            await asyncio.to_thread(_save_persistent, snapshot)

                else:
                    # CLOSED with data — serve cached / persisted data
                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()
                        for sym in self._last_snapshot:
                            if isinstance(self._last_snapshot[sym], dict):
                                self._last_snapshot[sym]["dataSource"] = "MARKET_CLOSED"
                                self._last_snapshot[sym]["timestamp"] = ts_now
                        await strike_intel_manager.broadcast({
                            "type": "strike_intel_update",
                            "data": self._last_snapshot,
                        })

                # Heartbeat
                if now_ts - last_heartbeat > self._heartbeat_interval:
                    last_heartbeat = now_ts
                    await strike_intel_manager.broadcast({
                        "type": "strike_intel_heartbeat",
                        "timestamp": datetime.now(IST).isoformat(),
                    })

                await asyncio.sleep(cadence)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Strike Intelligence loop error: %s", e, exc_info=True)
                await asyncio.sleep(10)


# ── Singleton ────────────────────────────────────────────────────────────────

_service: Optional[StrikeIntelligenceService] = None


def get_strike_intelligence_service() -> StrikeIntelligenceService:
    global _service
    if _service is None:
        _service = StrikeIntelligenceService()
    return _service

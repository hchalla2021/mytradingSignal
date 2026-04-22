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


def _approx_delta(spot: float, strike: float) -> float:
    """
    Synthetic CE delta using a logistic approximation of Black-Scholes N(d1).
    ATM (spot==strike) → 0.5  |  deep ITM → ~0.95  |  deep OTM → ~0.05
    Uses a 5% normalised moneyness as a proxy for one standard deviation.
    """
    if spot <= 0 or strike <= 0:
        return 0.5
    m = (spot - strike) / (spot * 0.05)   # normalised moneyness
    return 1.0 / (1.0 + math.exp(-m * 1.6))


def _compute_signal(
    ce_oi: int, pe_oi: int, ce_volume: int, pe_volume: int,
    ce_price: float, pe_price: float, ce_change: float, pe_change: float,
    spot: float, strike: int,
) -> Dict[str, Any]:
    """
    Compute buy/sell signal for a single strike from CE & PE data.

    Scoring factors:
      1. Volume imbalance     (±30) — Which side has more volume
      2. OI positioning       (±15) — OI buildup direction (writers vs holders)
      3. Price momentum       (±30) — Premium % change (most real-time indicator)
      4. Liquidity depth      (±10) — Total flow as market depth proxy
      5. Moneyness bias       (±10) — ITM premium is more actionable

    Advanced factors (new):
      6. BSL/SSL zone         (±12) — OI concentration above/below spot = institutional walls
      7. BOS structure        (±10) — CE/PE price divergence at ATM = breakout confirmation
      8. Delta-weighted vol   (±8)  — Moneyness-adjusted volume pressure (ITM vol > OTM vol)
      9. Trap detection       (−15) — High volume but price moves against = absorption trap

    CE score > 0 → calls active/rising → bullish for underlying
    PE score > 0 → puts active/rising → bearish for underlying
    """
    total_oi  = ce_oi  + pe_oi
    total_vol = ce_volume + pe_volume

    # ── CE Score ─────────────────────────────────────────────────────────

    ce_score = 0.0

    # 1. Volume dominance (±30)
    if total_vol > 0:
        ce_score += (ce_volume / total_vol - 0.5) * 2.0 * 30

    # 2. OI positioning (±15) — high CE OI = heavy writing = resistance = bearish for CE
    if total_oi > 0:
        ce_score += (0.5 - ce_oi / total_oi) * 2.0 * 15

    # 3. Price momentum (±30)
    if ce_price > 0:
        ce_score += _clamp((ce_change / ce_price) * 100 * 5, -30, 30)

    # 4. Liquidity depth (±10)
    if total_vol > 100:
        liq = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)
        ce_score += liq * 10 if ce_volume > pe_volume else -liq * 10

    # 5. Moneyness (±10)
    if spot > 0:
        m = (spot - strike) / spot * 100
        ce_score += min(m * 2, 10) if m > 0 else max(m * 1.5, -10)

    # ── PE Score ─────────────────────────────────────────────────────────

    pe_score = 0.0

    # 1. Volume dominance (±30)
    if total_vol > 0:
        pe_score += (pe_volume / total_vol - 0.5) * 2.0 * 30

    # 2. OI positioning (±15) — high PE OI = bearish positioning = bullish PE signal
    if total_oi > 0:
        pe_score += (pe_oi / total_oi - 0.5) * 2.0 * 15

    # 3. Price momentum (±30)
    if pe_price > 0:
        pe_score += _clamp((pe_change / pe_price) * 100 * 5, -30, 30)

    # 4. Liquidity depth (±10)
    if total_vol > 100:
        liq = min(math.log10(max(total_vol, 1)) / 6.0, 1.0)
        pe_score += liq * 10 if pe_volume > ce_volume else -liq * 10

    # 5. Moneyness (±10)
    if spot > 0:
        m = (strike - spot) / spot * 100
        pe_score += min(m * 2, 10) if m > 0 else max(m * 1.5, -10)

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 6: BSL / SSL Liquidity Zone
    # ═══════════════════════════════════════════════════════════════════════
    # BSL (Buy-Side Liquidity) = Stops sitting above spot → large CE OI above ATM
    #   → call writers defending that ceiling → resistance → headwind for CE buyers
    # SSL (Sell-Side Liquidity) = Stops sitting below spot → large PE OI below ATM
    #   → put writers defending that floor → support → tailwind for CE holders
    #
    # Only applies when strike is within 2% of spot (high-relevance zone)
    # ───────────────────────────────────────────────────────────────────────
    liq_type_ce: Optional[str] = None
    liq_type_pe: Optional[str] = None

    if spot > 0 and total_oi > 10_000:
        dist_ratio = (strike - spot) / spot          # + = above spot, – = below
        oi_weight  = min(math.log10(max(total_oi, 1)) / 7.0, 1.0)

        if 0.0 <= dist_ratio < 0.02:                 # Strike at/just above spot → BSL zone
            ce_dominance = (ce_oi - pe_oi) / (total_oi + 1)
            if ce_dominance > 0:                     # Call wall above = resistance
                liq_type_ce = "BSL"
                liq_type_pe = "BSL"
                ce_score -= ce_dominance * oi_weight * 12   # resistance headwind for CE
                pe_score += ce_dominance * oi_weight * 8    # ceiling confirmed = put support

        elif -0.02 < dist_ratio < 0.0:               # Strike just below spot → SSL zone
            pe_dominance = (pe_oi - ce_oi) / (total_oi + 1)
            if pe_dominance > 0:                     # Put wall below = support
                liq_type_ce = "SSL"
                liq_type_pe = "SSL"
                pe_score -= pe_dominance * oi_weight * 12   # floor being defended = bearish for PE
                ce_score += pe_dominance * oi_weight * 8    # support confirmed = tailwind for CE

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 7: BOS (Break of Structure)
    # ═══════════════════════════════════════════════════════════════════════
    # BOS UP:   CE price surging + PE price falling at near-ATM strike
    #           = market momentum confirms bullish structural break
    # BOS DOWN: PE price surging + CE price falling at near-ATM strike
    #           = market momentum confirms bearish structural break
    #
    # Proximity-weighted: strongest at ATM, fades for far OTM/ITM strikes
    # ───────────────────────────────────────────────────────────────────────
    bos_signal: Optional[str] = None

    if ce_price > 0 and pe_price > 0 and spot > 0:
        ce_pct = (ce_change / ce_price) * 100
        pe_pct = (pe_change / pe_price) * 100
        # Proximity to ATM: 1.0 at ATM, 0 at 3% away
        atm_prox = max(0.0, 1.0 - abs(spot - strike) / (spot * 0.03))

        divergence = ce_pct - pe_pct               # CE rising / PE falling = bullish BOS
        bos_boost  = _clamp(divergence * atm_prox * 0.7, -10, 10)
        ce_score  += bos_boost
        pe_score  -= bos_boost                     # inverted for PE

        if divergence > 3.0 and atm_prox > 0.25:
            bos_signal = "UP"
        elif divergence < -3.0 and atm_prox > 0.25:
            bos_signal = "DOWN"

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 8: Delta-Weighted Volume
    # ═══════════════════════════════════════════════════════════════════════
    # Synthetic delta scales volume impact by option moneyness:
    #   ITM option volume = bigger real market exposure (delta ≈ 0.8–0.95)
    #   OTM option volume = smaller exposure (delta ≈ 0.05–0.3)
    # Delta-adjusted CE vol dominating → stronger bullish signal than raw vol alone
    # ───────────────────────────────────────────────────────────────────────
    ce_delta = _approx_delta(spot, float(strike))
    pe_delta = 1.0 - ce_delta                      # put delta complement

    if total_vol > 0:
        ce_dv = ce_delta * ce_volume / (total_vol + 1)   # 0–1 range
        pe_dv = pe_delta * pe_volume / (total_vol + 1)
        delta_push = (ce_dv - pe_dv) * 16               # ±8 max
        ce_score  += delta_push
        pe_score  -= delta_push

    # ═══════════════════════════════════════════════════════════════════════
    #  ADVANCED FACTOR 9: Trap Detection
    # ═══════════════════════════════════════════════════════════════════════
    # A trap (absorption) occurs when:
    #   — One side dominates volume (many retail buyers piling in)
    #   — BUT that side's option price is flat or falling
    #   → Institutions are absorbing retail orders = price won't move their way
    #   → Strong negative signal for the "trapped" side
    #
    # Examples:
    #   CE Trap: CE volume > 60% of total BUT ce_change <= 0 → calls being sold into buyers
    #   PE Trap: PE volume > 60% of total BUT pe_change <= 0 → puts being sold into buyers
    # ───────────────────────────────────────────────────────────────────────
    trap_ce = False
    trap_pe = False

    if total_vol > 5_000:
        ce_vol_dom = ce_volume / (total_vol + 1)
        pe_vol_dom = pe_volume / (total_vol + 1)

        if ce_price > 0 and ce_vol_dom > 0.60:
            ce_pct_chg_ratio = ce_change / ce_price
            if ce_pct_chg_ratio < -0.02:             # Vol up but price falling = CE trap
                trap_ce = True
                ce_score -= 15

        if pe_price > 0 and pe_vol_dom > 0.60:
            pe_pct_chg_ratio = pe_change / pe_price
            if pe_pct_chg_ratio < -0.02:             # Vol up but price falling = PE trap
                trap_pe = True
                pe_score -= 15

    # ── Score → Signal conversion ─────────────────────────────────────────

    def _score_to_signal(score: float) -> str:
        if   score >=  46: return "STRONG_BUY"
        elif score >=  18: return "BUY"
        elif score <= -46: return "STRONG_SELL"
        elif score <= -18: return "SELL"
        return "NEUTRAL"

    def _score_to_pct(score: float) -> Dict[str, float]:
        clamped = _clamp(score, -110, 110)
        abs_s   = abs(clamped)
        if clamped >= 0:
            buy_pct  = 50.0 + abs_s * 0.40
            sell_pct = 50.0 - abs_s * 0.32
        else:
            sell_pct = 50.0 + abs_s * 0.40
            buy_pct  = 50.0 - abs_s * 0.32
        neutral_pct = max(0.0, 10.0 - abs_s * 0.09)
        total = buy_pct + sell_pct + neutral_pct
        # Integer percentages — avoids decimal bleed like "3.2%N" in the UI
        b = int(round(buy_pct     / total * 100))
        s = int(round(sell_pct    / total * 100))
        n = int(round(neutral_pct / total * 100))
        # Correct any ±1 rounding error so they always sum to 100
        diff = 100 - b - s - n
        b += diff  # absorb rounding error into the dominant (buy/sell) bucket
        return {"buyPct": b, "sellPct": s, "neutralPct": n}

    return {
        "ce": {
            "signal":    _score_to_signal(ce_score),
            "score":     round(ce_score, 1),
            "breakdown": _score_to_pct(ce_score),
            "oi":        ce_oi,
            "volume":    ce_volume,
            "price":     round(ce_price, 2),
            "change":    round(ce_change, 2),
            "signals": {
                "liq":   liq_type_ce,              # "BSL" | "SSL" | null
                "bos":   bos_signal,               # "UP"  | "DOWN" | null
                "delta": round(ce_delta, 3),       # synthetic CE delta (0.0–1.0)
                "trap":  trap_ce,                  # true = absorption trap detected
            },
        },
        "pe": {
            "signal":    _score_to_signal(pe_score),
            "score":     round(pe_score, 1),
            "breakdown": _score_to_pct(pe_score),
            "oi":        pe_oi,
            "volume":    pe_volume,
            "price":     round(pe_price, 2),
            "change":    round(pe_change, 2),
            "signals": {
                "liq":   liq_type_pe,              # "BSL" | "SSL" | null
                "bos":   bos_signal,               # "UP"  | "DOWN" | null (same break)
                "delta": round(pe_delta, 3),       # synthetic PE delta (0.0–1.0)
                "trap":  trap_pe,                  # true = absorption trap detected
            },
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


# ── Spot/ATM sync helper ─────────────────────────────────────────────────────

def _apply_spot_to_cached_entry(entry: Dict[str, Any], spot: float, symbol: str) -> Dict[str, Any]:
    """
    Given a cached entry (with stale spot/atm/isATM/labels), update it with
    the current real-time spot price. Only modifies spot, atm, isATM, and
    strike labels — Volume/OI values stay from the cached session.
    """
    step = STRIKE_STEP.get(symbol, 50)
    new_atm = _get_atm_strike(spot, step)
    updated = dict(entry)  # shallow copy — don't mutate original
    updated["spot"] = round(spot, 2)
    updated["atm"] = new_atm
    # Re-stamp strike labels and ATM flag
    new_strikes = []
    for row in entry.get("strikes", []):
        r = dict(row)
        s = r["strike"]
        diff = s - new_atm
        r["isATM"] = (s == new_atm)
        if diff == 0:
            r["label"] = "ATM"
        elif diff > 0:
            r["label"] = f"OTM+{diff // step}"
        else:
            r["label"] = f"ITM{diff // step}"
        new_strikes.append(r)
    updated["strikes"] = new_strikes
    return updated


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
        self._cadence_live = 1.0        # Broadcast every 1s during market hours
        self._cadence_fetch = 5.0       # Full Zerodha quote fetch every 5s
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
                # Real last-session data from disk — mark as LAST_CLOSE so the
                # frontend can show signals (unlike synthetic MARKET_CLOSED data)
                for sym in persisted:
                    if isinstance(persisted[sym], dict):
                        persisted[sym]["dataSource"] = "LAST_CLOSE"
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
                # Zero changes: no real price movement data when market is closed.
                # Non-zero values feed the momentum factor (±30) and produce false
                # directional signals (STRONG BUY / STRONG SELL) from synthetic data.
                "ce_change": 0.0,
                "pe_change": 0.0,
            }

        raw = {
            "atm": atm, "step": step, "spot": round(spot, 2),
            "expiry": "", "strikes": strike_data,
        }
        data = self._build_symbol_data(symbol, raw)
        data["dataSource"] = "MARKET_CLOSED"
        return data

    # ── Signal recomputation with live spot ──────────────────────────────

    def _recompute_signals_with_spot(self, entry: Dict[str, Any], spot: float, symbol: str) -> Dict[str, Any]:
        """
        Recompute per-strike signals using a fresh spot price every 1s.
        OI / volume / price / change are taken from the last Zerodha fetch.
        Only spot-sensitive components update every second:
          • moneyness bias, ATM recalculation, delta, BSL/SSL zone
        The BOS and Trap sub-signals are recomputed from stored price/change data.
        """
        step    = STRIKE_STEP.get(symbol, 50)
        new_atm = _get_atm_strike(spot, step)

        new_strikes = []
        for row in entry.get("strikes", []):
            strike_val = row["strike"]
            ce = row.get("ce", {})
            pe = row.get("pe", {})

            signals = _compute_signal(
                ce_oi=_safe_int(ce.get("oi")),
                pe_oi=_safe_int(pe.get("oi")),
                ce_volume=_safe_int(ce.get("volume")),
                pe_volume=_safe_int(pe.get("volume")),
                ce_price=_safe_float(ce.get("price")),
                pe_price=_safe_float(pe.get("price")),
                ce_change=_safe_float(ce.get("change")),
                pe_change=_safe_float(pe.get("change")),
                spot=spot,
                strike=strike_val,
            )

            diff = strike_val - new_atm
            if diff == 0:
                label = "ATM"
            elif diff > 0:
                label = f"OTM+{diff // step}"
            else:
                label = f"ITM{diff // step}"

            new_strikes.append({
                "strike":  strike_val,
                "label":   label,
                "isATM":   strike_val == new_atm,
                "ce":      signals["ce"],
                "pe":      signals["pe"],
            })

        updated          = dict(entry)
        updated["spot"]  = round(spot, 2)
        updated["atm"]   = new_atm
        updated["strikes"] = new_strikes
        return updated

    # ── Main loop ────────────────────────────────────────────────────────

    async def _run_loop(self):
        last_heartbeat = 0.0
        last_fetch_time = 0.0       # Tracks last Zerodha quote API call
        _closed_fetch_done = False  # Only fetch once during CLOSED to seed data

        while self._running:
            try:
                phase = self._get_market_phase()
                now_ts = time_mod.time()

                # ── LIVE / PRE_OPEN ───────────────────────────────────────────
                if phase in ("LIVE", "PRE_OPEN"):
                    _closed_fetch_done = False

                    # Full Zerodha quote fetch on first iteration and every _cadence_fetch seconds
                    if (now_ts - last_fetch_time) >= self._cadence_fetch:
                        self._init_kite()

                        async def _fetch_one(symbol: str) -> tuple:
                            try:
                                spot = self._get_spot_price(symbol)
                                if spot <= 0:
                                    return (symbol, None)
                                raw = await asyncio.to_thread(
                                    self._fetch_strikes_sync, symbol, spot
                                )
                                if raw:
                                    return (symbol, self._build_symbol_data(symbol, raw))
                                elif symbol in self._last_snapshot:
                                    entry = _apply_spot_to_cached_entry(
                                        self._last_snapshot[symbol], spot, symbol
                                    )
                                    entry["dataSource"] = "CACHED"
                                    return (symbol, entry)
                                return (symbol, None)
                            except Exception as e:
                                logger.debug("Strike intel fetch error for %s: %s", symbol, e)
                                return (symbol, None)

                        results = await asyncio.gather(
                            *[_fetch_one(sym) for sym in SYMBOLS],
                            return_exceptions=True,
                        )
                        for result in results:
                            if isinstance(result, Exception):
                                continue
                            sym, fresh = result
                            if fresh is not None:
                                self._last_snapshot[sym] = fresh

                        last_fetch_time = now_ts
                        if now_ts - self._last_save_time > 30 and self._last_snapshot:
                            self._last_save_time = now_ts
                            await asyncio.to_thread(_save_persistent, dict(self._last_snapshot))

                    # Every 1s: pull live spot from cache, recompute spot-sensitive signals, broadcast
                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()
                        broadcast_data: Dict[str, Any] = {}
                        for sym in SYMBOLS:
                            if sym not in self._last_snapshot:
                                continue
                            spot = self._get_spot_price(sym)
                            if spot > 0:
                                entry = self._recompute_signals_with_spot(
                                    self._last_snapshot[sym], spot, sym
                                )
                            else:
                                entry = dict(self._last_snapshot[sym])
                            entry["dataSource"] = "LIVE"
                            entry["timestamp"] = ts_now
                            self._last_snapshot[sym] = entry
                            broadcast_data[sym] = entry

                        if broadcast_data:
                            await strike_intel_manager.broadcast({
                                "type": "strike_intel_update",
                                "data": broadcast_data,
                            })

                    await asyncio.sleep(self._cadence_live)

                # ── CLOSED ───────────────────────────────────────────────────
                else:
                    # One-time fetch when first entering CLOSED with no snapshot
                    if not self._last_snapshot and not _closed_fetch_done:
                        self._init_kite()

                        async def _fetch_one_closed(symbol: str) -> tuple:
                            try:
                                spot = self._get_spot_price(symbol)
                                if spot <= 0:
                                    return (symbol, None)
                                raw = await asyncio.to_thread(
                                    self._fetch_strikes_sync, symbol, spot
                                )
                                if raw:
                                    data = self._build_symbol_data(symbol, raw)
                                    data["dataSource"] = "MARKET_CLOSED"
                                    return (symbol, data)
                                return (symbol, None)
                            except Exception as e:
                                logger.debug("Strike intel closed fetch error for %s: %s", symbol, e)
                                return (symbol, None)

                        results = await asyncio.gather(
                            *[_fetch_one_closed(sym) for sym in SYMBOLS],
                            return_exceptions=True,
                        )
                        for result in results:
                            if isinstance(result, Exception):
                                continue
                            sym, entry = result
                            if entry is not None:
                                self._last_snapshot[sym] = entry
                        _closed_fetch_done = True

                    if self._last_snapshot:
                        ts_now = datetime.now(IST).isoformat()
                        for sym in list(self._last_snapshot.keys()):
                            if not isinstance(self._last_snapshot[sym], dict):
                                continue
                            current_spot = self._get_spot_price(sym)
                            if current_spot > 0:
                                self._last_snapshot[sym] = _apply_spot_to_cached_entry(
                                    self._last_snapshot[sym], current_spot, sym
                                )
                            self._last_snapshot[sym]["dataSource"] = "MARKET_CLOSED"
                            self._last_snapshot[sym]["timestamp"] = ts_now
                        await strike_intel_manager.broadcast({
                            "type": "strike_intel_update",
                            "data": self._last_snapshot,
                        })

                    await asyncio.sleep(self._cadence_closed)

                # Heartbeat (every 30s)
                if now_ts - last_heartbeat > self._heartbeat_interval:
                    last_heartbeat = now_ts
                    await strike_intel_manager.broadcast({
                        "type": "strike_intel_heartbeat",
                        "timestamp": datetime.now(IST).isoformat(),
                    })

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

"""
🤖 Smart AI Algo Service
========================
Institutional-grade algo engine powered by OpenAI GPT-4o-mini.

Architecture:
  Zerodha tick data + indicators → Rule-based pre-filter
  → AI analysis (OpenAI) → Trade recommendation with SL/Target/TSL
  → WebSocket broadcast + REST endpoint

Parameters analyzed:
  Price action, EMA 20/100/200, VWAP, PCR, OI buildup,
  volume surge, liquidity sweep, equal highs/lows (SMC),
  support/resistance, market structure (HH/HL/LH/LL), RSI,
  change in OI, candle conviction.

AI Output per symbol:
  signal: BUY | SELL | WAIT
  entry_price, stop_loss, target, trailing_stop_loss
  confidence (0-100), reasoning (1-2 sentences), regime, strength
"""

import asyncio
import json
import logging
import math
import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

import pytz
import httpx
from kiteconnect import KiteConnect
from kiteconnect.exceptions import PermissionException

from services.cache import CacheService
from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
settings = get_settings()


def _settings():
    """Fetch latest settings to avoid stale env/token values during runtime."""
    return get_settings()

# ── Constants ────────────────────────────────────────────────────────────────
SYMBOLS = ["NIFTY", "BANKNIFTY", "SENSEX"]
DEFAULT_SL_POINTS = 10
DEFAULT_TARGET_POINTS = 15
TRAILING_SL_TRIGGER_RATIO = 0.5

# Cost-optimised AI gating:
#  • Only 1 batched call for all 3 symbols at once (3× cheaper than separate)
#  • Only fires when a symbol flips signal (WAIT→BUY/SELL or BUY→SELL etc.)
#  • Only during LIVE market hours
#  • Minimum 60 s cooldown per symbol after any AI call
#  • Rule engine must reach HIGH_CONFLUENCE_SCORE before AI is invoked
AI_COOLDOWN_SEC = 60          # minimum gap between AI calls per symbol
HIGH_CONFLUENCE_SCORE = 10    # responsive but still selective for AI enrichment
RULE_REFRESH_INTERVAL = 2     # rule engine runs every 2s (zero cost)
MAX_CONCURRENT_AI = 1         # single semaphore — no parallel API calls
AI_MAX_TOKENS = 150           # tight cap: signal+conf+1-line reason fits in 80

# ── Singleton ─────────────────────────────────────────────────────────────────
_ALGO_SERVICE: Optional["SmartAIAlgoService"] = None


def get_algo_service() -> "SmartAIAlgoService":
    global _ALGO_SERVICE
    if _ALGO_SERVICE is None:
        _ALGO_SERVICE = SmartAIAlgoService(CacheService())
    return _ALGO_SERVICE


# ── EMA helper ────────────────────────────────────────────────────────────────
def _ema(prices: List[float], period: int) -> float:
    if len(prices) < period:
        return prices[-1] if prices else 0.0
    k = 2.0 / (period + 1)
    val = prices[0]
    for p in prices[1:]:
        val = p * k + val * (1 - k)
    return val


# ── RSI helper ────────────────────────────────────────────────────────────────
def _rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [max(d, 0) for d in deltas[-period:]]
    losses = [abs(min(d, 0)) for d in deltas[-period:]]
    avg_g = sum(gains) / period
    avg_l = sum(losses) / period
    if avg_l == 0:
        return 100.0
    rs = avg_g / avg_l
    return 100 - (100 / (1 + rs))


class SmartAIAlgoService:
    def __init__(self, cache: CacheService):
        self._cache = cache
        self._results: Dict[str, Dict[str, Any]] = {s: self._empty(s) for s in SYMBOLS}
        self._running = False
        self._ai_semaphore = asyncio.Semaphore(MAX_CONCURRENT_AI)
        # AI enabled by default when OpenAI is configured; user can still toggle it off.
        self._ai_enabled: bool = bool(_settings().openai_api_key)
        # Track last AI call time and last signal per symbol for change-detection
        self._last_ai_call: Dict[str, float] = {s: 0.0 for s in SYMBOLS}
        self._last_signal: Dict[str, str] = {s: "WAIT" for s in SYMBOLS}
        self._price_history: Dict[str, List[float]] = {s: [] for s in SYMBOLS}
        self._last_trade_time: Dict[str, float] = {s: 0.0 for s in SYMBOLS}
        self._last_trade_side: Dict[str, str] = {s: "" for s in SYMBOLS}
        self._trade_history: List[Dict[str, Any]] = []
        self._instrument_token_map: Dict[int, Dict[str, str]] = {}
        self._instrument_meta_map: Dict[str, Dict[str, float]] = {}
        self._instruments_cache: Dict[str, Dict[str, Any]] = {}
        self._last_option_exec_info: Dict[str, Dict[str, Any]] = {s: {} for s in SYMBOLS}
        self._open_option_position: Dict[str, Dict[str, Any]] = {s: {} for s in SYMBOLS}
        self._trailing_state: Dict[str, Dict[str, Any]] = {
            s: {"side": "WAIT", "extreme": 0.0, "tsl": 0.0} for s in SYMBOLS
        }
        self._live_block_until_ts: float = 0.0

    @staticmethod
    def _empty(symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "signal": "WAIT",
            "entry_price": 0.0,
            "stop_loss": 0.0,
            "target": 0.0,
            "trailing_stop_loss": 0.0,
            "confidence": 0,
            "sl_points": DEFAULT_SL_POINTS,
            "target_points": DEFAULT_TARGET_POINTS,
            "regime": "UNKNOWN",
            "strength": 0,
            "reasoning": "Waiting for sufficient market data...",
            "indicators": {},
            "ai_powered": False,
            "last_updated": 0,
            "market_status": "CLOSED",
        }

    # ── Main loop ────────────────────────────────────────────────────────────
    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self._warm_price_history()
        logger.info("🤖 Smart AI Algo: started")
        while self._running:
            try:
                await self._tick()
            except Exception as exc:
                logger.error("Smart AI Algo tick error: %s", exc, exc_info=True)
            await asyncio.sleep(RULE_REFRESH_INTERVAL)

    async def _warm_price_history(self) -> None:
        """Seed moving averages from recent candle history so the first live ticks are meaningful."""
        candle_keys = ("analysis_candles", "analysis_candles_3m", "analysis_candles_15m")

        for symbol in SYMBOLS:
            seeded = False
            for prefix in candle_keys:
                try:
                    raw_items = await self._cache.lrange(f"{prefix}:{symbol}", 0, 199)
                except Exception:
                    raw_items = []

                closes: List[float] = []
                for item in reversed(raw_items):
                    try:
                        candle = item if isinstance(item, dict) else json.loads(item)
                        close = float(candle.get("close", 0) or 0)
                    except Exception:
                        continue
                    if close > 0:
                        closes.append(close)

                if closes:
                    self._price_history[symbol] = closes[-200:]
                    seeded = True
                    break

            if not seeded:
                try:
                    market_data = await self._cache.get_market_data(symbol)
                    price = float((market_data or {}).get("price", 0) or 0)
                    if price > 0:
                        self._price_history[symbol] = [price]
                except Exception:
                    pass

    async def stop(self) -> None:
        self._running = False

    # ── Main tick ─────────────────────────────────────────────────────────────
    async def _tick(self) -> None:
        candidates: List[tuple] = []   # (symbol, tick, indicators, rule_result) for AI

        for symbol in SYMBOLS:
            # Use cache service API instead of raw storage internals.
            # Raw cache entries are stored as (json_value, expire_at) tuples;
            # reading internals directly can silently break decoding and keep
            # all algo outputs stuck at WAIT with empty indicators.
            try:
                tick = await self._cache.get_market_data(symbol)
            except Exception:
                tick = None

            if not tick or not isinstance(tick, dict):
                continue

            indicators = self._build_indicators(symbol, tick)
            rule_result, buy_score, sell_score = self._rule_engine(symbol, tick, indicators)

            # Always publish rule result immediately (zero cost, zero latency).
            # Merge latest option execution context so UI can show the exact
            # option price reference (LTP/bid/ask/best buy) used for entries.
            merged_result = {**rule_result, "ai_powered": False}
            last_exec = self._last_option_exec_info.get(symbol) or {}
            if last_exec:
                merged_result.update(last_exec)

            # Dynamic trailing stop: lock profits only when structure extends
            # in favor (higher highs for BUY, lower lows for SELL).
            self._apply_structure_trailing_stop(symbol, tick, merged_result)
            self._results[symbol] = merged_result

            # Auto-trade execution stage (paper/live) on rule-confirmed signals.
            await self._maybe_execute_trade(symbol, tick, self._results[symbol])

            # ── AI gate: strict conditions to minimise tokens ──────────────
            now = time.time()
            signal = rule_result["signal"]
            market_live = indicators.get("market_status") == "LIVE"
            signal_changed = signal != self._last_signal[symbol] and signal != "WAIT"
            cooldown_ok = now - self._last_ai_call[symbol] >= AI_COOLDOWN_SEC
            strong_setup = max(buy_score, sell_score) >= HIGH_CONFLUENCE_SCORE

            if (
                self._ai_enabled
                and settings.openai_api_key
                and market_live
                and signal_changed
                and cooldown_ok
                and strong_setup
            ):
                candidates.append((symbol, tick, indicators, rule_result))
                self._last_ai_call[symbol] = now

            self._last_signal[symbol] = signal

        # Batch AI call for all qualifying symbols (1 API call, not 3)
        if candidates:
            asyncio.create_task(self._ai_batch(candidates))

    def _get_live_tradingsymbol(self, symbol: str) -> str:
        cfg = _settings()
        mapping = {
            "NIFTY": cfg.algo_live_symbol_nifty,
            "BANKNIFTY": cfg.algo_live_symbol_banknifty,
            "SENSEX": cfg.algo_live_symbol_sensex,
        }
        return (mapping.get(symbol) or "").strip()

    def _get_live_token(self, symbol: str) -> int:
        cfg = _settings()
        token_map = {
            "NIFTY": int(getattr(cfg, "nifty_fut_token", 0) or 0),
            "BANKNIFTY": int(getattr(cfg, "banknifty_fut_token", 0) or 0),
            "SENSEX": int(getattr(cfg, "sensex_fut_token", 0) or 0),
        }
        return token_map.get(symbol, 0)

    def _resolve_contract_from_token(self, kite: KiteConnect, symbol: str) -> tuple[str, str]:
        token = self._get_live_token(symbol)
        if token <= 0:
            return "", ""

        cached = self._instrument_token_map.get(token)
        if cached:
            return cached.get("exchange", ""), cached.get("tradingsymbol", "")

        for exchange in ("NFO", "BFO"):
            try:
                instruments = kite.instruments(exchange)
            except Exception:
                continue
            for inst in instruments:
                if int(inst.get("instrument_token", 0) or 0) != token:
                    continue
                tradingsymbol = str(inst.get("tradingsymbol", "") or "").strip()
                if tradingsymbol:
                    resolved = {"exchange": exchange, "tradingsymbol": tradingsymbol}
                    self._instrument_token_map[token] = resolved
                    return exchange, tradingsymbol

        return "", ""

    def _get_contract_meta(self, kite: KiteConnect, exchange: str, tradingsymbol: str) -> tuple[int, float]:
        ts_upper = (tradingsymbol or "").upper()

        # Fallback metadata for current index futures when instruments API is rate-limited.
        # Keeps order params exchange-valid even when live instrument dump cannot be fetched.
        if "BANKNIFTY" in ts_upper:
            fallback_lot, fallback_tick = 30, 0.20
        elif "SENSEX" in ts_upper:
            fallback_lot, fallback_tick = 20, 0.10
        elif "NIFTY" in ts_upper:
            fallback_lot, fallback_tick = 25, 0.10
        else:
            fallback_lot, fallback_tick = 1, 0.05

        key = f"{exchange}:{tradingsymbol}".upper()
        cached = self._instrument_meta_map.get(key)
        if cached:
            lot = int(cached.get("lot_size", 1) or 1)
            tick = float(cached.get("tick_size", 0.05) or 0.05)
            return max(1, lot), max(0.01, tick)

        try:
            instruments = kite.instruments(exchange)
        except Exception:
            return fallback_lot, fallback_tick

        for inst in instruments:
            ts = str(inst.get("tradingsymbol", "") or "").strip()
            if ts.upper() != tradingsymbol.upper():
                continue
            lot = int(inst.get("lot_size", 1) or 1)
            tick = float(inst.get("tick_size", 0.05) or 0.05)
            self._instrument_meta_map[key] = {
                "lot_size": max(1, lot),
                "tick_size": max(0.01, tick),
            }
            return max(1, lot), max(0.01, tick)

        return fallback_lot, fallback_tick

    @staticmethod
    def _round_price_to_tick(raw_price: float, tick_size: float, side: str) -> float:
        if tick_size <= 0:
            return round(raw_price, 2)
        steps = raw_price / tick_size
        if side == "BUY":
            steps = math.ceil(steps)
        else:
            steps = math.floor(steps)
        return round(max(tick_size, steps * tick_size), 2)

    @staticmethod
    def _extract_tick_size_from_error(error_msg: str) -> float:
        m = re.search(r"Tick size[^0-9]*([0-9]+(?:\.[0-9]+)?)", error_msg or "", flags=re.IGNORECASE)
        if not m:
            return 0.0
        try:
            return float(m.group(1))
        except Exception:
            return 0.0

    @staticmethod
    def _extract_qty_multiple_from_error(error_msg: str) -> int:
        m = re.search(r"multiple of\s+([0-9]+)", error_msg or "", flags=re.IGNORECASE)
        if not m:
            return 0
        try:
            return int(m.group(1))
        except Exception:
            return 0

    def _get_instruments_cached(self, kite: KiteConnect, exchange: str) -> List[Dict[str, Any]]:
        ex = (exchange or "").upper().strip()
        if not ex:
            return []
        now = time.time()
        cached = self._instruments_cache.get(ex)
        if cached and now - float(cached.get("ts", 0.0) or 0.0) < 600:
            return list(cached.get("data", []))

        try:
            data = kite.instruments(ex)
        except Exception:
            return list((cached or {}).get("data", []))

        if isinstance(data, list) and data:
            self._instruments_cache[ex] = {"ts": now, "data": data}
            return data
        return []

    def _resolve_option_contract(
        self,
        kite: KiteConnect,
        symbol: str,
        side: str,
        spot_price: float,
    ) -> Optional[Dict[str, Any]]:
        if spot_price <= 0:
            return None

        base_map = {
            "NIFTY": "NIFTY",
            "BANKNIFTY": "BANKNIFTY",
            "SENSEX": "SENSEX",
        }
        step_map = {
            "NIFTY": 50,
            "BANKNIFTY": 100,
            "SENSEX": 100,
        }

        base = base_map.get(symbol, symbol)
        strike_step = int(step_map.get(symbol, 50) or 50)
        exchange = "BFO" if symbol == "SENSEX" else "NFO"
        option_type = "CE" if side == "BUY" else "PE"
        atm_strike = round(spot_price / strike_step) * strike_step

        instruments = self._get_instruments_cached(kite, exchange)
        if not instruments:
            return None

        today = date.today()
        candidates: List[Dict[str, Any]] = []
        for inst in instruments:
            inst_type = str(inst.get("instrument_type", "") or "").upper()
            if inst_type != option_type:
                continue

            inst_name = str(inst.get("name", "") or "").upper()
            inst_ts = str(inst.get("tradingsymbol", "") or "").upper()
            if base not in inst_name and base not in inst_ts:
                continue

            expiry_raw = inst.get("expiry")
            expiry_date = None
            if isinstance(expiry_raw, date):
                expiry_date = expiry_raw
            elif isinstance(expiry_raw, str) and expiry_raw:
                try:
                    expiry_date = datetime.fromisoformat(expiry_raw[:10]).date()
                except Exception:
                    expiry_date = None
            if not expiry_date or expiry_date < today:
                continue

            strike = float(inst.get("strike", 0) or 0)
            if strike <= 0:
                continue

            lot_size = int(inst.get("lot_size", 0) or 0)
            tick_size = float(inst.get("tick_size", 0.05) or 0.05)
            tradingsymbol = str(inst.get("tradingsymbol", "") or "").strip()
            if not tradingsymbol:
                continue

            candidates.append(
                {
                    "exchange": exchange,
                    "tradingsymbol": tradingsymbol,
                    "option_type": option_type,
                    "expiry": expiry_date,
                    "strike": strike,
                    "lot_size": max(1, lot_size),
                    "tick_size": max(0.01, tick_size),
                    "dist": abs(strike - atm_strike),
                }
            )

        if not candidates:
            return None

        candidates.sort(key=lambda c: (c["expiry"], c["dist"]))

        nearest_expiry = candidates[0]["expiry"]
        same_expiry = [c for c in candidates if c["expiry"] == nearest_expiry]
        shortlist = same_expiry[:14]
        quote_keys = [f"{exchange}:{c['tradingsymbol']}" for c in shortlist]
        quote_map: Dict[str, Any] = {}
        if quote_keys:
            try:
                quote_map = kite.quote(quote_keys) or {}
            except Exception:
                quote_map = {}

        def _contract_score(c: Dict[str, Any]) -> tuple:
            q = quote_map.get(f"{exchange}:{c['tradingsymbol']}") or {}
            ltp = float(q.get("last_price", 0) or 0)
            vol = float(q.get("volume", 0) or 0)
            oi = float(q.get("oi", 0) or 0)
            depth = q.get("depth") or {}
            buy_depth = depth.get("buy") if isinstance(depth, dict) else []
            sell_depth = depth.get("sell") if isinstance(depth, dict) else []
            bid = float((buy_depth[0] or {}).get("price", 0) or 0) if isinstance(buy_depth, list) and buy_depth else 0.0
            ask = float((sell_depth[0] or {}).get("price", 0) or 0) if isinstance(sell_depth, list) and sell_depth else 0.0
            spread = (ask - bid) if ask > 0 and bid > 0 else 9999.0
            # Prioritize liquid/tight contracts first; then near ATM distance.
            return (
                0 if ltp > 0 else 1,
                0 if ask > 0 else 1,
                spread,
                -vol,
                -oi,
                c["dist"],
            )

        shortlist.sort(key=_contract_score)
        chosen = shortlist[0]
        chosen["expiry"] = chosen["expiry"].isoformat()
        return chosen

    @staticmethod
    def _passes_advanced_option_gate(ind: Dict[str, Any], side: str) -> tuple[bool, str]:
        if not ind:
            return False, "Indicators unavailable"

        p = float(ind.get("price", 0) or 0)
        e20 = float(ind.get("ema20", 0) or 0)
        e100 = float(ind.get("ema100", 0) or 0)
        e200 = float(ind.get("ema200", 0) or 0)
        rsi = float(ind.get("rsi", 0) or 0)
        vwap = float(ind.get("vwap", 0) or 0)
        pcr = float(ind.get("pcr", 0) or 0)
        oi_trend = str(ind.get("oi_trend", "") or "").upper()
        change_pct = float(ind.get("change_pct", 0) or 0)
        near_high = bool(ind.get("near_high", False))
        near_low = bool(ind.get("near_low", False))

        continuation_context = False
        if side == "BUY":
            continuation_context = (
                p >= (e20 * 0.998 if e20 > 0 else p)
                and e20 >= e100
                and change_pct >= 0.35
                and rsi >= 52
            )
            checks = [
                (p >= (e20 * 0.998 if e20 > 0 else p), "price materially below EMA20"),
                (e20 >= e100, "EMA stack not bullish"),
                (p >= vwap, "price below VWAP"),
                (40 <= rsi <= 82, "RSI outside bullish range"),
                (oi_trend in ("LONG_BUILDUP", "SHORT_COVERING"), "OI trend not bullish"),
                (change_pct >= 0.25, "change% too weak for CE"),
                (pcr == 0 or pcr >= 0.70, "PCR too bearish for CE"),
                (near_high or near_low or continuation_context, "no sweep/continuation context"),
            ]
        else:
            continuation_context = (
                p <= (e20 * 1.002 if e20 > 0 else p)
                and e20 <= e100
                and change_pct <= -0.35
                and rsi <= 48
            )
            checks = [
                (p <= (e20 * 1.002 if e20 > 0 else p), "price materially above EMA20"),
                (e20 <= e100, "EMA stack not bearish"),
                (p <= vwap, "price above VWAP"),
                (22 <= rsi <= 60, "RSI outside bearish range"),
                (oi_trend in ("SHORT_BUILDUP", "LONG_UNWINDING"), "OI trend not bearish"),
                (change_pct <= -0.25, "change% too weak for PE"),
                (pcr <= 1.05, "PCR too bullish for PE"),
                (near_high or near_low or continuation_context, "no sweep/continuation context"),
            ]

        failed = [msg for ok, msg in checks if not ok]
        if failed:
            return False, "; ".join(failed)
        return True, "Advanced options parameters satisfied"

    async def _ai_trade_confirm(
        self,
        symbol: str,
        side: str,
        ind: Dict[str, Any],
        rule_signal: Dict[str, Any],
    ) -> tuple[bool, str, int]:
        cfg = _settings()
        if not self._ai_enabled or not cfg.openai_api_key:
            # Fallback to rule-engine execution when AI is unavailable.
            # This prevents hard blocking of otherwise valid live setups.
            return True, "AI unavailable; fallback to rule-based execution", 60

        user_prompt = (
            f"Symbol={symbol}; Signal={side}; Entry={rule_signal.get('entry_price', 0)}; "
            f"EMA20={ind.get('ema20', 0)}; EMA100={ind.get('ema100', 0)}; EMA200={ind.get('ema200', 0)}; "
            f"RSI={ind.get('rsi', 0)}; VWAP={ind.get('vwap', 0)}; PCR={ind.get('pcr', 0)}; "
            f"OI={ind.get('oi_trend', '')}; Change={ind.get('change_pct', 0)}; "
            f"NearHigh={ind.get('near_high', False)}; NearLow={ind.get('near_low', False)}. "
            "Reply JSON only: {\"allow\":true|false,\"confidence\":0-100,\"reason\":\"short\"}. "
            "Allow only if setup has strong multi-factor confluence and momentum continuation probability > 0.6."
        )

        payload = {
            "model": cfg.openai_model,
            "messages": [
                {"role": "system", "content": "You are a strict intraday options execution validator. Return JSON only."},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "max_tokens": 80,
        }

        try:
            async with httpx.AsyncClient(timeout=cfg.openai_timeout) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    json=payload,
                    headers={
                        "Authorization": f"Bearer {cfg.openai_api_key}",
                        "Content-Type": "application/json",
                    },
                )
            if resp.status_code != 200:
                return False, f"AI confirmation HTTP {resp.status_code}", 0

            text = resp.json()["choices"][0]["message"]["content"].strip()
            if "```" in text:
                text = text.split("```")[1]
                if text.startswith("json"):
                    text = text[4:]
            data = json.loads(text)
            allow = bool(data.get("allow", False))
            ai_conf = int(data.get("confidence", 0) or 0)
            reason = str(data.get("reason", ""))
            if not allow or ai_conf < 60:
                return False, reason or "AI rejected setup", ai_conf
            return True, reason or "AI approved", ai_conf
        except Exception as exc:
            return False, f"AI confirmation failed: {exc}", 0

    async def _maybe_execute_trade(self, symbol: str, tick: Dict[str, Any], signal: Dict[str, Any]) -> None:
        cfg = _settings()

        if not cfg.algo_auto_trade_enabled:
            logger.debug("Smart AI trade skipped for %s: auto trade disabled", symbol)
            return

        side = str(signal.get("signal", "WAIT") or "WAIT").upper()
        if side not in ("BUY", "SELL"):
            return

        market_status = str(signal.get("market_status") or tick.get("status") or "CLOSED").upper()
        if market_status != "LIVE":
            logger.debug("Smart AI trade skipped for %s: market not live (%s)", symbol, market_status)
            return

        confidence = int(signal.get("confidence", 0) or 0)
        strength = int(signal.get("strength", 0) or 0)
        indicators = signal.get("indicators") or {}
        change_pct = float(indicators.get("change_pct", 0) or 0)
        trend = str(indicators.get("trend", "") or "").upper()

        # Adaptive threshold: allow slightly lower strength on strong directional continuation days.
        min_strength_required = int(cfg.algo_min_trade_strength)
        if side == "BUY" and change_pct >= 0.8 and trend in ("BULLISH", "STRONG_BUY"):
            min_strength_required = max(20, min_strength_required - 10)
        elif side == "SELL" and change_pct <= -0.8 and trend in ("BEARISH", "STRONG_SELL"):
            min_strength_required = max(20, min_strength_required - 10)

        if confidence < cfg.algo_min_trade_confidence:
            logger.debug(
                "Smart AI trade skipped for %s %s: confidence %s < %s",
                symbol,
                side,
                confidence,
                cfg.algo_min_trade_confidence,
            )
            return
        if strength < min_strength_required:
            logger.debug(
                "Smart AI trade skipped for %s %s: strength %s < %s",
                symbol,
                side,
                strength,
                min_strength_required,
            )
            return

        now = time.time()
        cooldown = max(0, int(cfg.algo_trade_cooldown_sec))
        if now - self._last_trade_time[symbol] < cooldown:
            logger.debug("Smart AI trade skipped for %s %s: cooldown active", symbol, side)
            return

        # Prevent repeated same-side spam orders for same symbol.
        if self._last_trade_side[symbol] == side:
            logger.debug("Smart AI trade skipped for %s %s: duplicate side suppression", symbol, side)
            return

        trade_event: Dict[str, Any] = {
            "symbol": symbol,
            "side": side,
            "entry_price": float(signal.get("entry_price", 0) or 0),
            "stop_loss": float(signal.get("stop_loss", 0) or 0),
            "target": float(signal.get("target", 0) or 0),
            "confidence": confidence,
            "strength": strength,
            "timestamp": datetime.now(IST).isoformat(),
            "mode": cfg.algo_auto_trade_mode,
            "status": "PENDING",
            "reason": signal.get("reasoning", ""),
        }

        mode = (cfg.algo_auto_trade_mode or "paper").lower().strip()
        if mode not in ("paper", "live"):
            mode = "paper"

        if mode == "paper":
            trade_event["status"] = "PAPER_EXECUTED"
            trade_event["broker_order_id"] = None
            self._record_trade(symbol, side, now, trade_event)
            logger.info("Smart AI PAPER trade recorded: %s %s", symbol, side)
            return

        if now < self._live_block_until_ts:
            trade_event["status"] = "LIVE_BLOCKED"
            trade_event["error"] = "Live order placement temporarily blocked after broker permission failure"
            signal["auto_buy_ready"] = False
            signal["auto_buy_block_reason"] = trade_event["error"]
            self._record_trade(symbol, side, now, trade_event)
            return

        # LIVE mode (OPTIONS ONLY): BUY CE for BUY signal, BUY PE for SELL signal.
        tradingsymbol = ""
        live_exchange = ""

        if not cfg.zerodha_api_key or not cfg.zerodha_access_token:
            trade_event["status"] = "SKIPPED"
            trade_event["error"] = "Zerodha credentials missing"
            self._record_trade(symbol, side, now, trade_event)
            logger.warning("Smart AI LIVE trade skipped for %s %s: Zerodha credentials missing", symbol, side)
            return

        kite = KiteConnect(api_key=cfg.zerodha_api_key)
        kite.set_access_token(cfg.zerodha_access_token)

        try:
            # For options strategy, we always BUY contracts (CE or PE).
            tx_side = kite.TRANSACTION_TYPE_BUY
            spot_ltp = float(signal.get("entry_price", 0) or 0)
            if spot_ltp <= 0:
                spot_ltp = float((tick or {}).get("price", 0) or 0)
            if spot_ltp <= 0:
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = "Invalid LTP for live order"
                self._record_trade(symbol, side, now, trade_event)
                return

            option_contract = self._resolve_option_contract(kite, symbol, side, spot_ltp)
            if not option_contract:
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = f"No suitable {symbol} {('CE' if side == 'BUY' else 'PE')} option contract found"
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = trade_event["error"]
                self._record_trade(symbol, side, now, trade_event)
                return

            live_exchange = str(option_contract["exchange"])
            tradingsymbol = str(option_contract["tradingsymbol"])
            option_type = str(option_contract.get("option_type", "") or "").upper()
            # Hard safety gate: never place futures/equity orders from Smart AI auto-trade.
            if option_type not in ("CE", "PE") or not tradingsymbol.upper().endswith(("CE", "PE")):
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = f"Options-only enforcement blocked non-option contract: {tradingsymbol}"
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = trade_event["error"]
                self._record_trade(symbol, side, now, trade_event)
                logger.error("Smart AI options-only block for %s: %s", symbol, tradingsymbol)
                return
            lot_size = int(option_contract["lot_size"])
            tick_size = float(option_contract["tick_size"])

            option_ltp = 0.0
            option_best_bid = 0.0
            option_best_ask = 0.0
            try:
                q = kite.quote([f"{live_exchange}:{tradingsymbol}"])
                quote_item = q.get(f"{live_exchange}:{tradingsymbol}") or {}
                option_ltp = float(quote_item.get("last_price", 0) or 0)
                depth = quote_item.get("depth") or {}
                buy_depth = depth.get("buy") if isinstance(depth, dict) else []
                sell_depth = depth.get("sell") if isinstance(depth, dict) else []
                if isinstance(buy_depth, list) and buy_depth:
                    option_best_bid = float((buy_depth[0] or {}).get("price", 0) or 0)
                if isinstance(sell_depth, list) and sell_depth:
                    option_best_ask = float((sell_depth[0] or {}).get("price", 0) or 0)
            except Exception:
                option_ltp = 0.0
            if option_ltp <= 0:
                option_ltp = max(tick_size, spot_ltp * 0.01)
            best_buy_price = option_best_ask if option_best_ask > 0 else option_ltp

            signal["option_tradingsymbol"] = tradingsymbol
            signal["option_type"] = option_contract.get("option_type")
            signal["option_expiry"] = option_contract.get("expiry")
            signal["option_strike"] = option_contract.get("strike")
            signal["option_ltp"] = option_ltp
            signal["option_best_bid_price"] = option_best_bid
            signal["option_best_ask_price"] = option_best_ask
            signal["option_best_buy_price"] = best_buy_price
            signal["option_price_updated_at"] = int(time.time() * 1000)
            signal["recommended_option_side"] = "CE" if side == "BUY" else "PE"

            pos = self._open_option_position.get(symbol) or {}
            if str(pos.get("tradingsymbol", "") or "") == tradingsymbol:
                entry_buy = float(pos.get("entry_buy_price", 0) or 0)
                pos_qty = int(pos.get("quantity", 0) or 0)
                if entry_buy > 0 and pos_qty > 0:
                    pnl_pts = option_ltp - entry_buy
                    pnl_amt = pnl_pts * float(pos_qty)
                    signal["option_entry_buy_price"] = entry_buy
                    signal["option_unrealized_pnl_points"] = round(pnl_pts, 2)
                    signal["option_unrealized_pnl_amount"] = round(pnl_amt, 2)
                    signal["option_pnl_status"] = "PROFIT" if pnl_amt > 0 else ("LOSS" if pnl_amt < 0 else "FLAT")

            ind = signal.get("indicators") or {}
            gate_ok, gate_reason = self._passes_advanced_option_gate(ind, side)
            signal["auto_buy_gate_passed"] = gate_ok
            signal["auto_buy_gate_reason"] = gate_reason
            if not gate_ok:
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = gate_reason
                trade_event["status"] = "SKIPPED"
                trade_event["error"] = gate_reason
                self._record_trade(symbol, side, now, trade_event)
                logger.info("Smart AI trade gate skipped for %s %s: %s", symbol, side, gate_reason)
                return

            ai_ok, ai_reason, ai_conf = await self._ai_trade_confirm(symbol, side, ind, signal)
            signal["auto_buy_ai_passed"] = ai_ok
            signal["auto_buy_ai_reason"] = ai_reason
            signal["auto_buy_ai_confidence"] = ai_conf
            if not ai_ok:
                signal["auto_buy_ready"] = False
                signal["auto_buy_block_reason"] = ai_reason
                trade_event["status"] = "AI_REJECTED"
                trade_event["error"] = ai_reason
                trade_event["ai_confidence"] = ai_conf
                self._record_trade(symbol, side, now, trade_event)
                logger.info("Smart AI trade rejected by AI for %s %s: %s", symbol, side, ai_reason)
                return
            signal["auto_buy_ready"] = True
            signal["auto_buy_block_reason"] = ""
            trade_event["ai_confidence"] = ai_conf
            trade_event["ai_reason"] = ai_reason

            # Zerodha API may reject pure market orders for some segments without market protection.
            # Use a near-LTP limit price with a small protective offset.
            price_offset = max(tick_size, option_ltp * 0.003)
            raw_limit = option_ltp + price_offset
            limit_price = self._round_price_to_tick(raw_limit, tick_size, "BUY")
            requested_qty = max(1, int(cfg.algo_trade_quantity))
            quantity = int(math.ceil(requested_qty / lot_size) * lot_size)
            order_id = None
            for attempt in range(3):
                try:
                    order_id = kite.place_order(
                        variety=kite.VARIETY_REGULAR,
                        exchange=live_exchange,
                        tradingsymbol=tradingsymbol,
                        transaction_type=tx_side,
                        quantity=quantity,
                        order_type=kite.ORDER_TYPE_LIMIT,
                        price=limit_price,
                        product=kite.PRODUCT_MIS,
                    )
                    break
                except Exception as order_exc:
                    error_text = str(order_exc)
                    adjusted = False

                    broker_tick = self._extract_tick_size_from_error(error_text)
                    if broker_tick > 0 and abs(broker_tick - tick_size) > 1e-9:
                        tick_size = broker_tick
                        limit_price = self._round_price_to_tick(raw_limit, tick_size, "BUY")
                        adjusted = True

                    broker_lot = self._extract_qty_multiple_from_error(error_text)
                    if broker_lot > 0 and (quantity % broker_lot != 0):
                        lot_size = broker_lot
                        quantity = int(math.ceil(quantity / broker_lot) * broker_lot)
                        adjusted = True

                    if adjusted and attempt < 2:
                        logger.warning(
                            "Smart AI LIVE order retry for %s %s with adjusted tick=%s lot=%s qty=%s price=%s",
                            symbol,
                            side,
                            tick_size,
                            lot_size,
                            quantity,
                            limit_price,
                        )
                        continue
                    raise

            if not order_id:
                raise RuntimeError("Broker did not return order_id")
            trade_event["status"] = "LIVE_EXECUTED"
            trade_event["broker_order_id"] = order_id
            trade_event["exchange"] = live_exchange
            trade_event["tradingsymbol"] = tradingsymbol
            trade_event["instrument_kind"] = "OPTION"
            trade_event["option_type"] = option_contract.get("option_type")
            trade_event["option_expiry"] = option_contract.get("expiry")
            trade_event["option_strike"] = option_contract.get("strike")
            trade_event["option_ltp"] = option_ltp
            trade_event["option_best_bid_price"] = option_best_bid
            trade_event["option_best_ask_price"] = option_best_ask
            trade_event["option_best_buy_price"] = best_buy_price
            trade_event["order_type"] = "LIMIT"
            trade_event["limit_price"] = limit_price
            trade_event["quantity"] = quantity
            trade_event["lot_size"] = lot_size
            trade_event["tick_size"] = tick_size

            self._last_option_exec_info[symbol] = {
                "option_tradingsymbol": tradingsymbol,
                "option_type": option_contract.get("option_type"),
                "option_expiry": option_contract.get("expiry"),
                "option_strike": option_contract.get("strike"),
                "option_ltp": option_ltp,
                "option_best_bid_price": option_best_bid,
                "option_best_ask_price": option_best_ask,
                "option_best_buy_price": best_buy_price,
                "option_price_updated_at": int(time.time() * 1000),
            }
            self._open_option_position[symbol] = {
                "tradingsymbol": tradingsymbol,
                "entry_buy_price": limit_price,
                "quantity": quantity,
                "ts": int(time.time() * 1000),
            }

            signal["option_entry_buy_price"] = limit_price
            signal["option_unrealized_pnl_points"] = round(option_ltp - limit_price, 2)
            signal["option_unrealized_pnl_amount"] = round((option_ltp - limit_price) * float(quantity), 2)
            signal["option_pnl_status"] = (
                "PROFIT"
                if option_ltp > limit_price
                else ("LOSS" if option_ltp < limit_price else "FLAT")
            )

            self._record_trade(symbol, side, now, trade_event)
            logger.info("Smart AI Algo LIVE order placed: %s %s -> %s", symbol, side, order_id)
        except Exception as exc:
            error_msg = str(exc)
            if isinstance(exc, PermissionException) and "No IPs configured for this app" in error_msg:
                # Zerodha app-level IP whitelist rejection. Pause live attempts briefly.
                self._live_block_until_ts = time.time() + 300
                trade_event["status"] = "LIVE_BLOCKED_IP"
                trade_event["error"] = (
                    "No IPs configured for this Kite app. Whitelist your server IP in Zerodha developer console. "
                    "Live retries paused for 5 minutes."
                )
                # Mark attempt time/side so symbol-level cooldown and duplicate suppression also apply.
                self._record_trade(symbol, side, now, trade_event)
            else:
                trade_event["status"] = "FAILED"
                trade_event["error"] = error_msg
                self._record_trade(symbol, side, now, trade_event)
            logger.error("Smart AI Algo LIVE order failed for %s: %s", symbol, exc, exc_info=True)

    def _record_trade(self, symbol: str, side: str, ts: float, event: Dict[str, Any]) -> None:
        if side in ("BUY", "SELL"):
            self._last_trade_side[symbol] = side
            self._last_trade_time[symbol] = ts

        self._trade_history.append(event)
        if len(self._trade_history) > 200:
            self._trade_history = self._trade_history[-200:]

    def _apply_structure_trailing_stop(self, symbol: str, tick: Dict[str, Any], signal: Dict[str, Any]) -> None:
        side = str(signal.get("signal", "WAIT") or "WAIT").upper()
        state = self._trailing_state.get(symbol) or {"side": "WAIT", "extreme": 0.0, "tsl": 0.0}

        if side not in ("BUY", "SELL"):
            self._trailing_state[symbol] = {"side": "WAIT", "extreme": 0.0, "tsl": 0.0}
            return

        entry = float(signal.get("entry_price", 0) or 0)
        sl_points = float(signal.get("sl_points", DEFAULT_SL_POINTS) or DEFAULT_SL_POINTS)
        high = float((tick or {}).get("high", 0) or 0)
        low = float((tick or {}).get("low", 0) or 0)

        if entry <= 0 or sl_points <= 0:
            return

        # Start a fresh trailing session whenever signal side flips or state is missing.
        if state.get("side") != side:
            initial_tsl = (
                round(entry - (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                if side == "BUY"
                else round(entry + (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
            )
            initial_extreme = entry
            if side == "BUY" and high > 0:
                initial_extreme = max(initial_extreme, high)
            elif side == "SELL" and low > 0:
                initial_extreme = min(initial_extreme, low)
            self._trailing_state[symbol] = {
                "side": side,
                "extreme": float(initial_extreme),
                "tsl": float(initial_tsl),
            }
            signal["trailing_stop_loss"] = initial_tsl
            return

        current_extreme = float(state.get("extreme", entry) or entry)
        current_tsl = float(state.get("tsl", signal.get("trailing_stop_loss", 0)) or 0)

        if side == "BUY":
            # Higher highs move TSL up; no backtracking on pullbacks.
            if high > 0 and high > current_extreme:
                current_extreme = high
                candidate_tsl = round(current_extreme - (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                current_tsl = max(current_tsl, candidate_tsl)
        else:
            # Lower lows move TSL down; no widening when price bounces up.
            if low > 0 and (current_extreme <= 0 or low < current_extreme):
                current_extreme = low
                candidate_tsl = round(current_extreme + (sl_points * TRAILING_SL_TRIGGER_RATIO), 2)
                current_tsl = candidate_tsl if current_tsl <= 0 else min(current_tsl, candidate_tsl)

        self._trailing_state[symbol] = {
            "side": side,
            "extreme": float(current_extreme),
            "tsl": float(current_tsl),
        }
        signal["trailing_stop_loss"] = round(current_tsl, 2)

    # ── Indicator computation ─────────────────────────────────────────────────
    def _build_indicators(self, symbol: str, tick: Dict) -> Dict[str, Any]:
        price = float(tick.get("price", 0) or 0)
        prev_close = float(tick.get("close", 0) or 0)
        high = float(tick.get("high", 0) or 0)
        low = float(tick.get("low", 0) or 0)
        volume = float(tick.get("volume", 0) or 0)
        oi = float(tick.get("oi", 0) or 0)
        pcr = float(tick.get("pcr", 1.0) or 1.0)
        call_oi = float(tick.get("callOI", 0) or 0)
        put_oi = float(tick.get("putOI", 0) or 0)
        change_pct = float(tick.get("changePercent", 0) or 0)

        # Price history (rolling 50 candles)
        hist = self._price_history[symbol]
        if not hist or hist[-1] != price:
            hist.append(price)
            if len(hist) > 200:
                hist.pop(0)

        ema20 = _ema(hist, 20) if len(hist) >= 20 else price
        ema100 = _ema(hist, 100) if len(hist) >= 100 else price
        ema200 = _ema(hist, 200) if len(hist) >= 200 else price
        rsi = _rsi(hist) if len(hist) >= 15 else 50.0

        # VWAP from analysis cache if available
        analysis = tick.get("analysis") or {}
        vwap = float(analysis.get("vwap", 0) or 0) or price

        # Equal high/low (liquidity sweep) detection — last 5 bars
        # We approximate using day high/low vs current price
        near_high = high > 0 and abs(price - high) / high < 0.002
        near_low = low > 0 and abs(price - low) / low < 0.002

        # OI trend
        oi_trend = "NEUTRAL"
        if change_pct > 0.1 and oi > 0:
            oi_trend = "LONG_BUILDUP"
        elif change_pct < -0.1 and oi > 0:
            oi_trend = "SHORT_BUILDUP"
        elif change_pct > 0.1:
            oi_trend = "SHORT_COVERING"
        elif change_pct < -0.1:
            oi_trend = "LONG_UNWINDING"

        # PCR sentiment
        if pcr > 1.2:
            pcr_bias = "BULLISH"
        elif pcr < 0.8:
            pcr_bias = "BEARISH"
        else:
            pcr_bias = "NEUTRAL"

        # EMAs alignment
        price_above_ema20 = price > ema20
        price_above_ema100 = price > ema100
        price_above_ema200 = price > ema200
        ema20_above_ema100 = ema20 > ema100
        ema100_above_ema200 = ema100 > ema200

        # Market structure from analysis (if present)
        trend = str(tick.get("trend", "NEUTRAL") or "NEUTRAL").upper()

        return {
            "price": price,
            "prev_close": prev_close,
            "high": high,
            "low": low,
            "volume": volume,
            "oi": oi,
            "pcr": pcr,
            "call_oi": call_oi,
            "put_oi": put_oi,
            "change_pct": change_pct,
            "ema20": round(ema20, 2),
            "ema100": round(ema100, 2),
            "ema200": round(ema200, 2),
            "rsi": round(rsi, 1),
            "vwap": round(vwap, 2),
            "oi_trend": oi_trend,
            "pcr_bias": pcr_bias,
            "near_high": near_high,
            "near_low": near_low,
            "price_above_ema20": price_above_ema20,
            "price_above_ema100": price_above_ema100,
            "price_above_ema200": price_above_ema200,
            "ema20_above_ema100": ema20_above_ema100,
            "ema100_above_ema200": ema100_above_ema200,
            "trend": trend,
            "market_status": str(tick.get("status", "CLOSED") or "CLOSED"),
        }

    # ── Rule engine (deterministic fast path) ────────────────────────────────
    def _rule_engine(self, symbol: str, tick: Dict, ind: Dict):
        """Returns (result_dict, buy_score, sell_score)."""
        p = ind["price"]
        if p <= 0:
            return self._empty(symbol), 0, 0

        sl_pts = DEFAULT_SL_POINTS
        tgt_pts = DEFAULT_TARGET_POINTS

        buy_score = 0
        sell_score = 0

        # --- BUY signals ---
        if ind["price_above_ema20"]:
            buy_score += 2
        if ind["price_above_ema100"]:
            buy_score += 2
        if ind["price_above_ema200"]:
            buy_score += 1
        if ind["ema20_above_ema100"]:
            buy_score += 2
        if ind["ema100_above_ema200"]:
            buy_score += 1
        if ind["pcr_bias"] == "BULLISH":
            buy_score += 2
        elif ind["pcr_bias"] == "BEARISH":
            buy_score -= 2
        if ind["oi_trend"] in ("LONG_BUILDUP", "SHORT_COVERING"):
            buy_score += 2
        elif ind["oi_trend"] in ("SHORT_BUILDUP", "LONG_UNWINDING"):
            buy_score -= 2
        if ind["rsi"] > 55 and ind["rsi"] < 75:
            buy_score += 1
        elif ind["rsi"] < 45:
            buy_score -= 1
        if ind["trend"] in ("BULLISH", "STRONG_BUY"):
            buy_score += 2
        elif ind["trend"] in ("BEARISH", "STRONG_SELL"):
            buy_score -= 2
        if p > ind["vwap"] and ind["vwap"] > 0:
            buy_score += 1
        elif p < ind["vwap"] and ind["vwap"] > 0:
            buy_score -= 1
        if ind["change_pct"] >= 0.25:
            buy_score += 1
        elif ind["change_pct"] <= -0.25:
            buy_score -= 2
        if ind["near_low"] and ind["pcr_bias"] == "BULLISH":
            buy_score += 2  # liquidity sweep at low — potential reversal

        # --- SELL signals ---
        if not ind["price_above_ema20"]:
            sell_score += 2
        if not ind["price_above_ema100"]:
            sell_score += 2
        if not ind["price_above_ema200"]:
            sell_score += 1
        if not ind["ema20_above_ema100"]:
            sell_score += 2
        if not ind["ema100_above_ema200"]:
            sell_score += 1
        if ind["pcr_bias"] == "BEARISH":
            sell_score += 2
        elif ind["pcr_bias"] == "BULLISH":
            sell_score -= 2
        if ind["oi_trend"] in ("SHORT_BUILDUP", "LONG_UNWINDING"):
            sell_score += 2
        elif ind["oi_trend"] in ("LONG_BUILDUP", "SHORT_COVERING"):
            sell_score -= 2
        if ind["rsi"] < 45 and ind["rsi"] > 25:
            sell_score += 1
        elif ind["rsi"] > 55:
            sell_score -= 1
        if ind["trend"] in ("BEARISH", "STRONG_SELL"):
            sell_score += 2
        elif ind["trend"] in ("BULLISH", "STRONG_BUY"):
            sell_score -= 2
        if p < ind["vwap"] and ind["vwap"] > 0:
            sell_score += 1
        elif p > ind["vwap"] and ind["vwap"] > 0:
            sell_score -= 1
        if ind["change_pct"] <= -0.25:
            sell_score += 1
        elif ind["change_pct"] >= 0.25:
            sell_score -= 2
        if ind["near_high"] and ind["pcr_bias"] == "BEARISH":
            sell_score += 2  # liquidity sweep at high — potential rejection

        total = buy_score + sell_score
        confidence = min(int((max(buy_score, sell_score) / max(total, 1)) * 100), 95)
        strength = min(int(max(buy_score, sell_score) * 5), 100)

        signal = "WAIT"
        entry = p
        sl = p - sl_pts
        tgt = p + tgt_pts
        tsl = p - (sl_pts * 0.5)
        regime = "SIDEWAYS"
        reasoning = "Market conditions unclear. Waiting for confluence."

        if buy_score >= 7 and buy_score > sell_score * 1.2:
            signal = "BUY"
            entry = p
            sl = round(p - sl_pts, 2)
            tgt = round(p + tgt_pts, 2)
            tsl = round(p - sl_pts * 0.5, 2)
            regime = "TRENDING_UP"
            reasoning = (
                f"Price above EMA20/100, PCR={ind['pcr']:.2f} ({ind['pcr_bias']}), "
                f"OI={ind['oi_trend']}, RSI={ind['rsi']}"
            )
        elif sell_score >= 7 and sell_score > buy_score * 1.2:
            signal = "SELL"
            entry = p
            sl = round(p + sl_pts, 2)
            tgt = round(p - tgt_pts, 2)
            tsl = round(p + sl_pts * 0.5, 2)
            regime = "TRENDING_DOWN"
            reasoning = (
                f"Price below EMA20/100, PCR={ind['pcr']:.2f} ({ind['pcr_bias']}), "
                f"OI={ind['oi_trend']}, RSI={ind['rsi']}"
            )

        # Keep directional signal from rule engine; enforce strict gate only in
        # execution stage so valid momentum setups are not prematurely flattened to WAIT.
        buy_gate_ok, buy_gate_reason = self._passes_advanced_option_gate(ind, "BUY")
        sell_gate_ok, sell_gate_reason = self._passes_advanced_option_gate(ind, "SELL")

        if signal == "BUY":
            reasoning = (
                reasoning if buy_gate_ok
                else f"BUY setup forming; execution gate pending ({buy_gate_reason})"
            )
        elif signal == "SELL":
            reasoning = (
                reasoning if sell_gate_ok
                else f"SELL setup forming; execution gate pending ({sell_gate_reason})"
            )

        # Determine market regime only when there is no actionable signal.
        if signal == "WAIT":
            if abs(ind["change_pct"]) < 0.15:
                regime = "SIDEWAYS"
            elif ind["change_pct"] > 0.3:
                regime = "TRENDING_UP"
            elif ind["change_pct"] < -0.3:
                regime = "TRENDING_DOWN"

        return {
            "symbol": symbol,
            "signal": signal,
            "entry_price": entry,
            "stop_loss": sl,
            "target": tgt,
            "trailing_stop_loss": tsl,
            "confidence": confidence,
            "sl_points": sl_pts,
            "target_points": tgt_pts,
            "regime": regime,
            "strength": strength,
            "reasoning": reasoning,
            "indicators": ind,
            "ai_powered": False,
            "last_updated": int(time.time() * 1000),
            "market_status": ind["market_status"],
        }, buy_score, sell_score

    # ── Batched AI call (1 request for all qualifying symbols) ───────────────
    async def _ai_batch(self, candidates: List[tuple]) -> None:
        """Call OpenAI ONCE with all candidate symbols in a single message.
        Ultra-compact prompt — keeps input tokens under 150 per symbol."""
        async with self._ai_semaphore:
            try:
                await self._call_openai_batch(candidates)
            except Exception as exc:
                logger.debug("AI batch skipped: %s", exc)

    async def _call_openai_batch(self, candidates: List[tuple]) -> None:
        if not settings.openai_api_key:
            return

        # Build a single ultra-compact block per symbol (≈60 tokens each)
        blocks = []
        for sym, _tick, ind, rule in candidates:
            blocks.append(
                f"{sym}|px:{ind['price']}|chg:{ind['change_pct']:.2f}%|"
                f"e20:{ind['ema20']}|e100:{ind['ema100']}|rsi:{ind['rsi']:.0f}|"
                f"pcr:{ind['pcr']:.2f}({ind['pcr_bias'][0]})|oi:{ind['oi_trend'][:4]}|"
                f"vwap:{ind['vwap']}|rule:{rule['signal']}@{rule['confidence']}%"
            )

        syms = [c[0] for c in candidates]
        data_block = "\n".join(blocks)

        # System prompt is tiny — reused across all calls (cached by OpenAI server)
        system = "Indian index algo. JSON only. No prose."

        user = (
            f"Validate these {len(syms)} signal(s):\n{data_block}\n"
            f'Reply JSON array: [{{"s":"SYM","sig":"BUY|SELL|WAIT","conf":0-100,"why":"<10 words"}}]'
        )

        payload = {
            "model": settings.openai_model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "temperature": 0,           # deterministic = no sampling cost overhead
            "max_tokens": AI_MAX_TOKENS,
        }

        async with httpx.AsyncClient(timeout=settings.openai_timeout) as client:
            resp = await client.post(
                "https://api.openai.com/v1/chat/completions",
                json=payload,
                headers={
                    "Authorization": f"Bearer {settings.openai_api_key}",
                    "Content-Type": "application/json",
                },
            )

        if resp.status_code != 200:
            logger.warning("OpenAI batch → HTTP %s", resp.status_code)
            return

        text = resp.json()["choices"][0]["message"]["content"].strip()
        # Strip markdown fences if model adds them
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]

        ai_list = json.loads(text)
        if not isinstance(ai_list, list):
            return

        # Map AI results back to each symbol
        ai_map = {item["s"]: item for item in ai_list if "s" in item}
        for sym, _tick, ind, rule in candidates:
            item = ai_map.get(sym)
            if not item:
                continue
            # Only override if AI agrees with rule direction or has high confidence
            ai_sig = str(item.get("sig", rule["signal"])).upper()
            ai_conf = int(item.get("conf", rule["confidence"]))
            ai_why = str(item.get("why", rule["reasoning"]))

            # Don't let AI flip a strong rule signal to opposite unless conf > 80
            if ai_sig != rule["signal"] and ai_conf < 80:
                ai_sig = rule["signal"]

            merged = {
                **self._results[sym],
                "signal": ai_sig,
                "confidence": ai_conf,
                "reasoning": ai_why,
                "ai_powered": True,
                "last_updated": int(time.time() * 1000),
            }
            # Recalculate SL/Target if signal flipped
            if ai_sig != rule["signal"] and ai_sig != "WAIT":
                p = merged["entry_price"]
                sl_pts = merged["sl_points"]
                tgt_pts = merged["target_points"]
                if ai_sig == "BUY":
                    merged["stop_loss"] = round(p - sl_pts, 2)
                    merged["target"] = round(p + tgt_pts, 2)
                    merged["trailing_stop_loss"] = round(p - sl_pts * 0.5, 2)
                else:
                    merged["stop_loss"] = round(p + sl_pts, 2)
                    merged["target"] = round(p - tgt_pts, 2)
                    merged["trailing_stop_loss"] = round(p + sl_pts * 0.5, 2)

            self._results[sym] = merged

    # ── Public API ───────────────────────────────────────────────────────────
    def set_ai_enabled(self, enabled: bool) -> None:
        """Toggle AI (OpenAI) enrichment. OFF = zero token spend."""
        self._ai_enabled = enabled
        if not enabled:
            # Clear ai_powered flag on all results so UI reflects the change
            for sym in SYMBOLS:
                r = self._results.get(sym)
                if r:
                    r["ai_powered"] = False
        logger.info("Smart AI Algo: AI enrichment %s", "ENABLED" if enabled else "DISABLED")

    def get_ai_enabled(self) -> bool:
        return self._ai_enabled

    def get_result(self, symbol: str) -> Dict[str, Any]:
        return self._results.get(symbol, self._empty(symbol))

    def get_all_results(self) -> Dict[str, Any]:
        return {s: self._results.get(s, self._empty(s)) for s in SYMBOLS}

    def get_trade_history(self, limit: int = 100) -> List[Dict[str, Any]]:
        lim = max(1, min(500, int(limit or 100)))
        return list(reversed(self._trade_history[-lim:]))

    def update_sl_target(
        self, symbol: str, sl_points: float, target_points: float
    ) -> None:
        r = self._results.get(symbol)
        if not r:
            return
        p = r["entry_price"] or r["indicators"].get("price", 0)
        sig = r["signal"]
        r["sl_points"] = sl_points
        r["target_points"] = target_points
        if sig == "BUY":
            r["stop_loss"] = round(p - sl_points, 2)
            r["target"] = round(p + target_points, 2)
            r["trailing_stop_loss"] = round(p - sl_points * 0.5, 2)
        elif sig == "SELL":
            r["stop_loss"] = round(p + sl_points, 2)
            r["target"] = round(p - target_points, 2)
            r["trailing_stop_loss"] = round(p + sl_points * 0.5, 2)

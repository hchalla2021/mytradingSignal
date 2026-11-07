import asyncio
import json
import logging
import math
import time
from datetime import datetime
from typing import Any, Dict, List, Optional

from services.algo_strategy_lab import StrategyLab
from services.cache import CacheService

logger = logging.getLogger(__name__)

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
RULE_REFRESH_INTERVAL = 2
ATR_PERIOD = 14
ROC_LOOKBACK = 5
EMA_SLOPE_LOOKBACK = 5
BOLLINGER_WINDOW = 20

_CONFIRMATION_SERVICE: Optional["AQTEConfirmationService"] = None


def get_aqte_confirmation_service() -> "AQTEConfirmationService":
    global _CONFIRMATION_SERVICE
    if _CONFIRMATION_SERVICE is None:
        _CONFIRMATION_SERVICE = AQTEConfirmationService(CacheService())
    return _CONFIRMATION_SERVICE


def _ema(prices: List[float], period: int) -> float:
    if len(prices) < period:
        return prices[-1] if prices else 0.0
    k = 2.0 / (period + 1)
    value = prices[0]
    for price in prices[1:]:
        value = price * k + value * (1 - k)
    return value


def _rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    deltas = [prices[i] - prices[i - 1] for i in range(1, len(prices))]
    gains = [max(delta, 0) for delta in deltas[-period:]]
    losses = [abs(min(delta, 0)) for delta in deltas[-period:]]
    average_gain = sum(gains) / period
    average_loss = sum(losses) / period
    if average_loss == 0:
        return 100.0
    relative_strength = average_gain / average_loss
    return 100 - (100 / (1 + relative_strength))


def _stdev(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return math.sqrt(sum((value - mean) ** 2 for value in values) / (len(values) - 1))


def _atr_proxy(prices: List[float], window: int = ATR_PERIOD) -> float:
    if len(prices) < window + 1:
        return 0.0
    changes = [abs(prices[i] - prices[i - 1]) for i in range(1, len(prices))]
    recent = changes[-window:]
    return sum(recent) / len(recent) if recent else 0.0


def _roc(prices: List[float], lookback: int = ROC_LOOKBACK) -> float:
    if len(prices) <= lookback:
        return 0.0
    previous = prices[-lookback - 1]
    return (prices[-1] - previous) / previous * 100 if previous > 0 else 0.0


def _ema_slope_pct(prices: List[float], period: int, lookback: int = EMA_SLOPE_LOOKBACK) -> float:
    if len(prices) < period + lookback:
        return 0.0
    previous = _ema(prices[:-lookback], period)
    return (_ema(prices, period) - previous) / previous * 100 if previous > 0 else 0.0


def _detect_regime(atr_pct: float, ema20: float, ema100: float, atr: float) -> Dict[str, Any]:
    if atr_pct <= 0:
        volatility = "UNKNOWN"
    elif atr_pct < 0.15:
        volatility = "LOW"
    elif atr_pct < 0.35:
        volatility = "NORMAL"
    elif atr_pct < 0.75:
        volatility = "HIGH"
    else:
        volatility = "EXTREME"

    spread = abs(ema20 - ema100)
    if atr <= 0 or spread <= 0 or spread / atr < 0.4:
        trend = "RANGING"
    elif spread / atr < 1.2:
        trend = "TRENDING_WEAK"
    else:
        trend = "TRENDING_STRONG"
    return {
        "volatility": volatility,
        "trend": trend,
        "favorable": trend in ("TRENDING_WEAK", "TRENDING_STRONG")
        and volatility in ("LOW", "NORMAL", "HIGH"),
    }


class AQTEConfirmationService:
    def __init__(self, cache: CacheService):
        self._cache = cache
        self._results: Dict[str, Dict[str, Any]] = {symbol: self._empty(symbol) for symbol in SYMBOLS}
        self._price_history: Dict[str, List[float]] = {symbol: [] for symbol in SYMBOLS}
        self._strategy_lab = StrategyLab(cache)
        self._running = False

    @staticmethod
    def _empty(symbol: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "data_status": "NO_DATA",
            "tick_age_seconds": -1,
            "last_updated": 0,
            "market_status": "CLOSED",
            "indicators": {},
            "strategy_lab": {
                "updated": 0,
                "consensus": {"signal": "NEUTRAL", "fired": False},
            },
            "market_direction": {},
            "early_warning": {},
        }

    async def start(self) -> None:
        if self._running:
            return
        self._running = True
        await self._warm_price_history()
        logger.info("AQTE strategy confirmation provider started")
        while self._running:
            try:
                await self._tick()
            except Exception:
                logger.exception("AQTE confirmation tick failed")
            await asyncio.sleep(RULE_REFRESH_INTERVAL)

    async def stop(self) -> None:
        self._running = False

    async def _warm_price_history(self) -> None:
        for symbol in SYMBOLS:
            seeded = False
            for prefix in ("analysis_candles", "analysis_candles_3m", "analysis_candles_15m"):
                try:
                    raw_items = await self._cache.lrange(f"{prefix}:{symbol}", 0, 199)
                except Exception:
                    logger.debug("AQTE confirmation history unavailable for %s (%s)", symbol, prefix, exc_info=True)
                    continue
                closes: List[float] = []
                for item in reversed(raw_items):
                    try:
                        candle = item if isinstance(item, dict) else json.loads(item)
                        close = float(candle.get("close", 0) or 0)
                    except (TypeError, ValueError, json.JSONDecodeError):
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
                    logger.debug("AQTE confirmation could not seed %s from the current quote", symbol, exc_info=True)

    async def _tick(self) -> None:
        for symbol in SYMBOLS:
            try:
                await self._tick_symbol(symbol)
            except Exception:
                logger.exception("AQTE confirmation failed for %s", symbol)
                result = self._results[symbol]
                result.update({
                    "last_updated": int(time.time() * 1000),
                    "data_status": "ERROR",
                    "tick_age_seconds": -1,
                })

    async def _tick_symbol(self, symbol: str) -> None:
        tick = await self._cache.get_market_data(symbol)
        now_ms = int(time.time() * 1000)
        if not isinstance(tick, dict) or not tick:
            self._results[symbol].update({
                "last_updated": now_ms,
                "data_status": "NO_DATA",
                "tick_age_seconds": -1,
            })
            return

        tick_age = self._compute_tick_age_seconds(tick)
        data_status = "UNKNOWN" if tick_age < 0 else "LIVE" if tick_age <= 10 else "SLOW" if tick_age <= 30 else "STALE"
        indicators = self._build_indicators(symbol, tick)
        result = self._empty(symbol)
        result.update({
            "last_updated": now_ms,
            "market_status": str(tick.get("status", "CLOSED") or "CLOSED"),
            "data_status": data_status,
            "tick_age_seconds": tick_age,
            "indicators": indicators,
        })
        try:
            lab = await self._strategy_lab.evaluate(symbol, tick, indicators)
            result.update({
                "strategy_lab": lab.get("strategy_lab") or result["strategy_lab"],
                "market_direction": lab.get("market_direction") or result["market_direction"],
                "early_warning": lab.get("early_warning") or result["early_warning"],
            })
        except Exception:
            logger.exception("AQTE Strategy Lab evaluation failed for %s", symbol)
        self._results[symbol] = result

    @staticmethod
    def _compute_tick_age_seconds(tick: Dict[str, Any]) -> int:
        raw_timestamp = tick.get("timestamp")
        if not raw_timestamp:
            return -1
        try:
            timestamp = datetime.fromisoformat(str(raw_timestamp))
            now = datetime.now(timestamp.tzinfo) if timestamp.tzinfo else datetime.now()
            return max(0, int((now - timestamp).total_seconds()))
        except (TypeError, ValueError, OverflowError):
            return -1

    def _build_indicators(self, symbol: str, tick: Dict[str, Any]) -> Dict[str, Any]:
        price = float(tick.get("price", 0) or 0)
        previous_close = float(tick.get("close", 0) or 0)
        high = float(tick.get("high", 0) or 0)
        low = float(tick.get("low", 0) or 0)
        volume = float(tick.get("volume", 0) or 0)
        oi = float(tick.get("oi", 0) or 0)
        pcr = float(tick.get("pcr", 1.0) or 1.0)
        call_oi = float(tick.get("callOI", 0) or 0)
        put_oi = float(tick.get("putOI", 0) or 0)
        change_pct = float(tick.get("changePercent", 0) or 0)

        history = self._price_history[symbol]
        if not history or history[-1] != price:
            history.append(price)
            if len(history) > 200:
                history.pop(0)

        ema20 = _ema(history, 20) if len(history) >= 20 else price
        ema100 = _ema(history, 100) if len(history) >= 100 else price
        ema200 = _ema(history, 200) if len(history) >= 200 else price
        rsi = _rsi(history) if len(history) >= 15 else 50.0
        analysis = tick.get("analysis") or {}
        vwap = float(analysis.get("vwap", 0) or 0) or price
        atr = _atr_proxy(history)
        atr_pct = atr / price * 100 if price > 0 else 0.0
        roc5 = _roc(history)
        roc10 = _roc(history, 10)
        ema20_slope_pct = _ema_slope_pct(history, 20)
        if len(history) >= BOLLINGER_WINDOW:
            segment = history[-BOLLINGER_WINDOW:]
            mean = sum(segment) / len(segment)
            standard_deviation = _stdev(segment)
            bb_z = (price - mean) / standard_deviation if standard_deviation > 0 else 0.0
        else:
            bb_z = 0.0
        vwap_dist_pct = (price - vwap) / vwap * 100 if vwap > 0 else 0.0
        pcr_z = (pcr - 1.0) / 0.25 if pcr > 0 else 0.0

        if change_pct > 0.1 and oi > 0:
            oi_trend = "LONG_BUILDUP"
        elif change_pct < -0.1 and oi > 0:
            oi_trend = "SHORT_BUILDUP"
        elif change_pct > 0.1:
            oi_trend = "SHORT_COVERING"
        elif change_pct < -0.1:
            oi_trend = "LONG_UNWINDING"
        else:
            oi_trend = "NEUTRAL"
        pcr_bias = "BULLISH" if pcr > 1.2 else "BEARISH" if pcr < 0.8 else "NEUTRAL"
        trend = str(tick.get("trend", "NEUTRAL") or "NEUTRAL").upper()

        return {
            "price": price,
            "prev_close": previous_close,
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
            "near_high": high > 0 and abs(price - high) / high < 0.002,
            "near_low": low > 0 and abs(price - low) / low < 0.002,
            "price_above_ema20": price > ema20,
            "price_above_ema100": price > ema100,
            "price_above_ema200": price > ema200,
            "ema20_above_ema100": ema20 > ema100,
            "ema100_above_ema200": ema100 > ema200,
            "trend": trend,
            "market_status": str(tick.get("status", "CLOSED") or "CLOSED"),
            "atr": round(atr, 2),
            "atr_pct": round(atr_pct, 3),
            "roc5": round(roc5, 3),
            "roc10": round(roc10, 3),
            "ema20_slope_pct": round(ema20_slope_pct, 3),
            "bb_z": round(bb_z, 3),
            "vwap_dist_pct": round(vwap_dist_pct, 3),
            "pcr_z": round(pcr_z, 3),
            "regime_detail": _detect_regime(atr_pct, ema20, ema100, atr),
        }

    def get_result(self, symbol: str) -> Dict[str, Any]:
        return self._results.get(symbol, self._empty(symbol))

    def get_all_results(self) -> Dict[str, Dict[str, Any]]:
        return {symbol: self.get_result(symbol) for symbol in SYMBOLS}

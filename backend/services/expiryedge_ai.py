"""Independent ExpiryEdge opening-range signals; evaluation never submits orders."""

from __future__ import annotations

import math
from datetime import datetime
from typing import Any

from services.aqte_engine import IST, day, minute_of_day, session
from services.expiryedge import SYMBOLS

OPENING_RANGE_START = 9 * 60 + 15
OPENING_RANGE_MINUTES = 5
FIRST_ENTRY_MINUTE = OPENING_RANGE_START + OPENING_RANGE_MINUTES
ATR_PERIOD = 14
MAX_BAR_AGE_SECONDS = 90
ATR_TRAIL_MULTIPLE = 1.5


def _valid_bar(bar: dict[str, Any]) -> bool:
    try:
        at = float(bar["at"])
        values = [float(bar[key]) for key in ("open", "high", "low", "close", "volume")]
    except (KeyError, TypeError, ValueError):
        return False
    open_price, high, low, close, volume = values
    return (
        math.isfinite(at)
        and all(math.isfinite(value) for value in values)
        and min(open_price, high, low, close) > 0
        and high >= max(open_price, low, close)
        and low <= min(open_price, high, close)
        and volume >= 0
    )


def _wait(reason: str, **values: Any) -> dict[str, Any]:
    return {
        "ready": False,
        "decision": "WAIT",
        "side": None,
        "reason": reason,
        "setup_key": None,
        **values,
    }


def evaluate_opening_range(
    symbol: str, bars: list[dict[str, Any]], now: float,
) -> dict[str, Any]:
    """Evaluate completed one-minute futures bars for one supported index."""
    if symbol not in SYMBOLS:
        return _wait(f"Unsupported ExpiryEdge index: {symbol}")
    now_dt = datetime.fromtimestamp(now, IST)
    if now_dt.weekday() >= 5 or not session(now):
        return _wait("Outside the regular trading session")
    if minute_of_day(now) < FIRST_ENTRY_MINUTE:
        return _wait("Opening range is not complete; the first eligible entry is after 09:20 IST")

    completed = sorted(
        (bar for bar in bars if _valid_bar(bar) and float(bar["at"]) + 60 <= now and session(float(bar["at"]))),
        key=lambda bar: float(bar["at"]),
    )
    today = [bar for bar in completed if day(float(bar["at"])) == day(now)]
    if not today:
        return _wait(f"Waiting for completed {symbol} one-minute futures candles")

    latest = today[-1]
    age = now - (float(latest["at"]) + 60)
    if age < 0 or age > MAX_BAR_AGE_SECONDS:
        return _wait("Latest completed futures candle is stale")

    opening = [
        bar for bar in today
        if OPENING_RANGE_START <= minute_of_day(float(bar["at"])) < FIRST_ENTRY_MINUTE
    ]
    expected_opening_times = {
        float(datetime.combine(
            now_dt.date(),
            datetime.min.time().replace(hour=9, minute=15 + index),
            tzinfo=IST,
        ).timestamp())
        for index in range(OPENING_RANGE_MINUTES)
    }
    if {float(bar["at"]) for bar in opening} != expected_opening_times:
        return _wait("Opening-range candles are incomplete; waiting for all five 09:15-09:19 bars")
    if len(today) < OPENING_RANGE_MINUTES:
        return _wait("Waiting for the completed five-minute opening range")

    volume = sum(float(bar["volume"]) for bar in today)
    if volume <= 0:
        return _wait("Session volume is unavailable; VWAP cannot be calculated")
    vwap = sum(
        (float(bar["high"]) + float(bar["low"]) + float(bar["close"])) / 3 * float(bar["volume"])
        for bar in today
    ) / volume
    range_high = max(float(bar["high"]) for bar in opening)
    range_low = min(float(bar["low"]) for bar in opening)

    recent = completed[-(ATR_PERIOD + 1):]
    if len(recent) < ATR_PERIOD + 1:
        return _wait(f"Warming up ATR: {len(recent) - 1}/{ATR_PERIOD} completed candles",
                     opening_range_high=range_high, opening_range_low=range_low, vwap=vwap)
    true_ranges = []
    for previous, current in zip(recent, recent[1:]):
        high, low = float(current["high"]), float(current["low"])
        same_session_day = day(float(previous["at"])) == day(float(current["at"]))
        previous_close = float(previous["close"]) if same_session_day else float(current["open"])
        true_ranges.append(max(high - low, abs(high - previous_close), abs(low - previous_close)))
    atr = sum(true_ranges) / len(true_ranges)
    if not math.isfinite(atr) or atr <= 0:
        return _wait("ATR is unavailable", opening_range_high=range_high,
                     opening_range_low=range_low, vwap=vwap)

    close = float(latest["close"])
    open_price = float(latest["open"])
    side = None
    if close > range_high and close > vwap and close >= open_price:
        side = "CE"
        stop = max(range_low, range_high - ATR_TRAIL_MULTIPLE * atr)
    elif close < range_low and close < vwap and close <= open_price:
        side = "PE"
        stop = min(range_high, range_low + ATR_TRAIL_MULTIPLE * atr)
    else:
        return _wait("No confirmed opening-range breakout with VWAP agreement",
                     opening_range_high=range_high, opening_range_low=range_low,
                     vwap=vwap, atr=atr, last_close=close)

    setup_at = int(float(latest["at"]))
    return {
        "ready": True,
        "decision": "BUY CE" if side == "CE" else "BUY PE",
        "side": side,
        "reason": "Completed one-minute close broke the five-minute opening range with VWAP confirmation",
        "setup_key": f"{symbol}:ORB_VWAP:{day(now)}:{setup_at}:{side}",
        "signal_at": setup_at + 60,
        "last_close": close,
        "opening_range_high": range_high,
        "opening_range_low": range_low,
        "vwap": vwap,
        "atr": atr,
        "underlying_stop": stop,
        "trail_distance": ATR_TRAIL_MULTIPLE * atr,
    }


def evaluate_nifty_opening_range(bars: list[dict[str, Any]], now: float) -> dict[str, Any]:
    """Backward-compatible NIFTY evaluator."""
    return evaluate_opening_range("NIFTY", bars, now)


def live_market_snapshot(market: Any, now: float, symbol: str = "NIFTY") -> dict[str, Any]:
    """Read the shared authenticated Kite feed and evaluate without mutating trade state."""
    with market.lock, market.health_lock:
        engine = market.engine
        future = engine.future.get(symbol)
        fresh_future = future is not None and engine.fresh(future, now)
        bars = (
            list(engine.book.closed.get(("future", future.token, 60), ()))
            if future is not None else []
        )
        connected = market.feed_connected is True and fresh_future
        last_tick_at = future.at if fresh_future else None
    result = evaluate_opening_range(symbol, bars, now)
    return {
        "market_data": {
            "state": "CONNECTED" if connected else "NOT_CONNECTED",
            "last_tick_at": datetime.fromtimestamp(last_tick_at, IST).isoformat()
            if last_tick_at is not None else None,
        },
        "signal": result,
    }


def live_market_snapshots(market: Any, now: float) -> dict[str, dict[str, Any]]:
    """Return independent feed and signal snapshots for all supported indices."""
    return {symbol: live_market_snapshot(market, now, symbol) for symbol in SYMBOLS}

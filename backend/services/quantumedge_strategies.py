"""QuantumEdge's ranked entry rules. No AI, broker, or UI dependencies."""

from collections.abc import Mapping, Sequence
from math import isfinite
from statistics import mean
from typing import Literal, TypedDict

from services.aqte_engine import OPEN_MINUTE, Candle, closed_intelligence, minute_of_day
from services.aqte_engines import resample

STRATEGIES = {
    "vwap_pullback": "VWAP Trend Pullback",
    "opening_range": "Opening Range Breakout",
    "liquidity_sweep": "Confirmed Liquidity Sweep",
    "timeframe_alignment": "Multi-Timeframe Trend Alignment",
    "vwap_cross": "VWAP Reclaim / Breakdown",
    "compression_expansion": "Volatility Compression to Expansion",
    "ema_pullback": "EMA 9/20 Momentum Pullback",
    "previous_day_break": "Previous Day High/Low Breakout",
    "volume_imbalance": "Candle-Volume Imbalance (proxy)",
    "trap_reversal": "Failed Breakout / Trap Reversal",
    "supertrend_vwap": "SuperTrend + VWAP",
    "cpr_break": "CPR + Pivot Range Breakout",
    "camarilla_break": "Camarilla H3/H4 & L3/L4 Breakout",
    "orb_pullback": "First Pullback After ORB",
}
SPOT_STRATEGIES = frozenset({"previous_day_break", "cpr_break", "camarilla_break"})


class Setup(TypedDict):
    id: str
    name: str
    side: Literal["CE", "PE"]
    reason: str


def previous_spot_levels(source: object, today: str) -> tuple[float, float, float] | None:
    if not isinstance(source, Mapping) or source.get("prepared_for") != today:
        return None
    session_day = source.get("session_day")
    high, low, close = (source.get(k) for k in ("high", "low", "close"))
    if (isinstance(session_day, str) and session_day < today
            and isinstance(high, (float, int)) and isinstance(low, (float, int))
            and isinstance(close, (float, int)) and all(map(isfinite, (high, low, close)))
            and 0 < low < high and low <= close <= high):
        return high, low, close
    return None


def _ema(values: Sequence[float], period: int) -> float:
    value = mean(values[:period])
    for close in values[period:]:
        value += 2 / (period + 1) * (close - value)
    return value


def select_setup(
    bars: Sequence[Candle], now: float, *,
    spot_bars: Sequence[Candle] = (),
    prior_spot: tuple[float, float, float] | None = None,
) -> tuple[Setup | None, str]:
    """Choose one match. Opposing directions are not resolved by rank alone."""
    expected = int(now // 60) * 60 - 60
    if len(bars) < 16 or any(
        b["at"] != expected - i * 60 for i, b in enumerate(reversed(bars[-16:]))
    ):
        return None, "Need 16 consecutive completed one-minute futures candles"

    b, p = bars[-1], bars[-2]
    c, pc = b["close"], p["close"]
    body = c - b["open"]
    matches: dict[str, Setup] = {}
    start = len(bars) - 16
    while start > 0 and bars[start]["at"] - bars[start - 1]["at"] == 60:
        start -= 1
    recent = bars[start:]
    atr = mean(max(y["high"] - y["low"], abs(y["high"] - x["close"]),
                   abs(y["low"] - x["close"])) for x, y in zip(bars[-16:-2], bars[-15:-1]))
    volume_ok = b["volume"] >= 1.3 * mean(x["volume"] for x in bars[-16:-1]) > 0
    up_break = c > p["high"] and body > 0
    down_break = c < p["low"] and body < 0

    def match(key: str, reason: str, *, up: bool, down: bool) -> None:
        if up != down:
            matches[key] = {"id": key, "name": STRATEGIES[key], "side": "CE" if up else "PE", "reason": reason}

    if len(recent) == len(bars) and minute_of_day(bars[0]["at"]) == OPEN_MINUTE:
        volume = sum(x["volume"] for x in bars[:-1])
        if atr > 0 and volume > 0 and b["volume"] > 0:
            value = sum((x["high"] + x["low"] + x["close"]) * x["volume"] / 3 for x in bars[:-1])
            previous_vwap = value / volume
            vwap = (value + (b["high"] + b["low"] + c) * b["volume"] / 3) / (volume + b["volume"])
            if p["low"] <= previous_vwap + .25 * atr and p["high"] >= previous_vwap - .25 * atr:
                match("vwap_pullback", "Pullback to session VWAP followed by a directional break",
                      up=c > vwap > previous_vwap and up_break,
                      down=c < vwap < previous_vwap and down_break)
            if volume_ok:
                match("vwap_cross", "Directional close crosses session VWAP on at least 1.3x volume",
                      up=pc <= previous_vwap and c > vwap and body > 0,
                      down=pc >= previous_vwap and c < vwap and body < 0)
            if up_break or down_break:
                indicators = closed_intelligence(recent, now, partial=True)
                trend = indicators.get("supertrend") if indicators else None
                match("supertrend_vwap", "SuperTrend (14, 3) and session VWAP confirm the candle break",
                      up=up_break and trend == "BULLISH" and c > vwap,
                      down=down_break and trend == "BEARISH" and c < vwap)

        opening = bars[:15]
        opening_volume = mean(x["volume"] for x in opening)
        or_high, or_low = max(x["high"] for x in opening), min(x["low"] for x in opening)
        if opening_volume > 0:
            def orb_side(i: int) -> int:
                prior_close, bar = bars[i-1]["close"], bars[i]
                close, op = bar["close"], bar["open"]
                if bar["volume"] < 1.5 * opening_volume:
                    return 0
                return int(prior_close <= or_high < close and close > op) - int(
                    prior_close >= or_low > close and close < op)

            if len(bars) <= 60:
                sign = orb_side(len(bars) - 1)
                match("opening_range", "Close breaks the 15-minute range on at least 1.5x opening volume",
                      up=sign == 1, down=sign == -1)
            first = next(((i, sign) for i in range(15, min(60, len(bars) - 1))
                          if (sign := orb_side(i))), None)
            if first and b["volume"] > 0:
                i, sign = first
                level = or_high if sign == 1 else or_low
                tolerance = .15 * mean(x["high"] - x["low"] for x in bars[i-14:i])
                def touches(bar: Candle) -> bool:
                    return bar["low"] <= level + tolerance and bar["high"] >= level - tolerance
                if (touches(b) and sign * (c - level) > 0 and sign * body > 0
                        and not any(touches(x) or sign * (x["close"] - level) <= 0 for x in bars[i+1:-1])):
                    match("orb_pullback", "First retest holds a volume-qualified opening-range break",
                          up=sign == 1, down=sign == -1)

    prior = bars[-12:-2]
    high, low = max(x["high"] for x in prior), min(x["low"] for x in prior)
    if b["volume"] > 0:
        match("liquidity_sweep", "Wick sweeps a ten-bar extreme; next close confirms reversal",
              up=p["low"] < low < pc and up_break, down=p["high"] > high > pc and down_break)
    if volume_ok:
        match("trap_reversal", "Volume-backed reversal returns inside the prior ten-bar range",
              up=pc < low < c < high and body > 0, down=pc > high > c > low and body < 0)
        tight = bars[-6:-1]
        top, bottom = max(x["high"] for x in tight), min(x["low"] for x in tight)
        if atr > 0 and top - bottom <= 1.5 * atr and b["high"] - b["low"] >= 1.3 * atr:
            match("compression_expansion", "Tight five-bar range breaks on volume and at least 1.3 ATR range",
                  up=pc <= top < c and body > 0, down=pc >= bottom > c and body < 0)
        pressure = bars[-5:]
        signed = sum(x["volume"] * (int(x["close"] > x["open"]) - int(x["close"] < x["open"])) for x in pressure)
        total = sum(x["volume"] for x in pressure)
        match("volume_imbalance", "Five-bar signed candle volume reaches 40%; not aggressor-side trade delta",
              up=total > 0 and signed >= .4 * total and up_break,
              down=total > 0 and signed <= -.4 * total and down_break)

    if len(recent) >= 20 and b["volume"] > 0 and (up_break or down_break):
        closes = [x["close"] for x in recent]
        fast, slow = _ema(closes, 9), _ema(closes, 20)
        match("ema_pullback", "EMA 9/20 trend and prior pullback followed by a directional break",
              up=up_break and c > fast > slow and slow <= p["low"] <= fast,
              down=down_break and c < fast < slow and fast <= p["high"] <= slow)
        if len(recent) >= 90:
            frames: list[list[float]] = [resample(recent, seconds) for seconds in (300, 900)]
            if all(len(frame) >= 6 for frame in frames):
                trend = [(frame[-1], _ema(frame, 5), _ema(frame[:-1], 5)) for frame in frames]
                match("timeframe_alignment", "Completed 5m and 15m EMA5 slopes confirm the 1m break",
                      up=up_break and all(last > avg > prev for last, avg, prev in trend),
                      down=down_break and all(last < avg < prev for last, avg, prev in trend))

    spot_ready = (len(spot_bars) >= 2 and spot_bars[-2]["at"] == expected - 60
                  and spot_bars[-1]["at"] == expected)
    if prior_spot and spot_ready:
        high, low, close = prior_spot
        last, prev = spot_bars[-1]["close"], spot_bars[-2]["close"]
        match("previous_day_break", "Spot closes through the previous session high or low",
              up=prev <= high < last, down=prev >= low > last)
        pivot, base = (high + low + close) / 3, (high + low) / 2
        bottom, top = sorted((base, 2 * pivot - base))
        match("cpr_break", "Spot closes outside the previous-session central pivot range",
              up=prev <= top < last, down=prev >= bottom > last)
        width = 1.1 * (high - low)
        match("camarilla_break", "Spot moves from H3/L3 through the H4/L4 breakout level",
              up=close + width / 4 <= prev <= close + width / 2 < last,
              down=close - width / 4 >= prev >= close - width / 2 > last)

    if not matches:
        reason = "No qualifying entry among the 14 strategies"
        if prior_spot is None or not spot_ready:
            reason += "; prior-day spot levels unavailable"
        return None, reason
    if len({setup["side"] for setup in matches.values()}) > 1:
        return None, "Qualified setups point in opposite directions"
    selected = next(matches[key] for key in STRATEGIES if key in matches)
    return selected, selected["reason"]

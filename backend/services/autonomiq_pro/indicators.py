"""Pure indicator and option-pricing functions (no I/O) for AUTONOMIQ PRO."""

from __future__ import annotations

import math
from typing import Sequence


def ema(values: Sequence[float], period: int) -> list[float]:
    if not values:
        return []
    k = 2 / (period + 1)
    out = [float(values[0])]
    for value in values[1:]:
        out.append(value * k + out[-1] * (1 - k))
    return out


def rsi(closes: Sequence[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    gains = losses = 0.0
    for i in range(1, period + 1):
        delta = closes[i] - closes[i - 1]
        gains += max(delta, 0)
        losses += max(-delta, 0)
    avg_gain, avg_loss = gains / period, losses / period
    for i in range(period + 1, len(closes)):
        delta = closes[i] - closes[i - 1]
        avg_gain = (avg_gain * (period - 1) + max(delta, 0)) / period
        avg_loss = (avg_loss * (period - 1) + max(-delta, 0)) / period
    if avg_loss == 0:
        return 100.0 if avg_gain > 0 else 50.0
    return 100 - 100 / (1 + avg_gain / avg_loss)


def true_ranges(candles: Sequence[dict]) -> list[float]:
    out = []
    for i, c in enumerate(candles):
        if i == 0:
            out.append(c["high"] - c["low"])
        else:
            prev = candles[i - 1]["close"]
            out.append(max(c["high"] - c["low"], abs(c["high"] - prev), abs(c["low"] - prev)))
    return out


def atr_series(candles: Sequence[dict], period: int = 14) -> list[float | None]:
    trs = true_ranges(candles)
    out: list[float | None] = [None] * len(trs)
    if len(trs) < period:
        return out
    value = sum(trs[:period]) / period
    out[period - 1] = value
    for i in range(period, len(trs)):
        value = (value * (period - 1) + trs[i]) / period
        out[i] = value
    return out


def atr(candles: Sequence[dict], period: int = 14) -> float | None:
    series = atr_series(candles, period)
    return series[-1] if series else None


def supertrend(candles: Sequence[dict], period: int = 10, multiplier: float = 3.0) -> tuple[int, float] | None:
    """Return (direction, line) for the last candle; direction is +1 (up) or -1 (down)."""
    atrs = atr_series(candles, period)
    if len(candles) <= period or atrs[-1] is None:
        return None
    upper = lower = None
    direction = 1
    line = 0.0
    for i in range(period - 1, len(candles)):
        c, a = candles[i], atrs[i]
        mid = (c["high"] + c["low"]) / 2
        basic_upper, basic_lower = mid + multiplier * a, mid - multiplier * a
        prev_close = candles[i - 1]["close"] if i else c["close"]
        upper = basic_upper if upper is None or basic_upper < upper or prev_close > upper else upper
        lower = basic_lower if lower is None or basic_lower > lower or prev_close < lower else lower
        if c["close"] > upper:
            direction = 1
        elif c["close"] < lower:
            direction = -1
        line = lower if direction == 1 else upper
    return direction, line


def vwap(candles: Sequence[dict]) -> float | None:
    volume = sum(c.get("volume") or 0 for c in candles)
    if volume <= 0:
        return None
    return sum(((c["high"] + c["low"] + c["close"]) / 3) * (c.get("volume") or 0) for c in candles) / volume


def resample(candles: Sequence[dict], factor: int) -> list[dict]:
    """Group consecutive candles of the same session day into larger candles."""
    out: list[dict] = []
    bucket: list[dict] = []
    for c in candles:
        if bucket and (len(bucket) == factor or str(c["date"])[:10] != str(bucket[0]["date"])[:10]):
            out.append(_merge(bucket))
            bucket = []
        bucket.append(c)
    if len(bucket) == factor:
        out.append(_merge(bucket))
    return out


def _merge(bucket: Sequence[dict]) -> dict:
    return {
        "date": bucket[0]["date"], "open": bucket[0]["open"], "close": bucket[-1]["close"],
        "high": max(c["high"] for c in bucket), "low": min(c["low"] for c in bucket),
        "volume": sum(c.get("volume") or 0 for c in bucket),
    }


def _norm_cdf(x: float) -> float:
    return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _norm_pdf(x: float) -> float:
    return math.exp(-0.5 * x * x) / math.sqrt(2 * math.pi)


def bs_price(spot: float, strike: float, years: float, rate: float, vol: float, kind: str) -> float:
    if years <= 0 or vol <= 0:
        return max(spot - strike, 0) if kind == "CE" else max(strike - spot, 0)
    d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * math.sqrt(years))
    d2 = d1 - vol * math.sqrt(years)
    if kind == "CE":
        return spot * _norm_cdf(d1) - strike * math.exp(-rate * years) * _norm_cdf(d2)
    return strike * math.exp(-rate * years) * _norm_cdf(-d2) - spot * _norm_cdf(-d1)


def implied_vol(price: float, spot: float, strike: float, years: float, rate: float, kind: str) -> float | None:
    if price <= 0 or spot <= 0 or strike <= 0 or years <= 0:
        return None
    intrinsic = max(spot - strike, 0) if kind == "CE" else max(strike - spot, 0)
    if price < intrinsic:
        return None
    low, high = 0.005, 5.0
    if bs_price(spot, strike, years, rate, high, kind) < price:
        return None
    for _ in range(80):
        mid = (low + high) / 2
        if bs_price(spot, strike, years, rate, mid, kind) > price:
            high = mid
        else:
            low = mid
    return (low + high) / 2


def greeks(spot: float, strike: float, years: float, rate: float, vol: float, kind: str) -> dict:
    if years <= 0 or vol <= 0:
        return {"delta": None, "gamma": None, "theta": None, "vega": None}
    sq = math.sqrt(years)
    d1 = (math.log(spot / strike) + (rate + vol * vol / 2) * years) / (vol * sq)
    d2 = d1 - vol * sq
    gamma = _norm_pdf(d1) / (spot * vol * sq)
    vega = spot * _norm_pdf(d1) * sq / 100
    if kind == "CE":
        delta = _norm_cdf(d1)
        theta = (-spot * _norm_pdf(d1) * vol / (2 * sq) - rate * strike * math.exp(-rate * years) * _norm_cdf(d2)) / 365
    else:
        delta = _norm_cdf(d1) - 1
        theta = (-spot * _norm_pdf(d1) * vol / (2 * sq) + rate * strike * math.exp(-rate * years) * _norm_cdf(-d2)) / 365
    return {"delta": round(delta, 4), "gamma": round(gamma, 6), "theta": round(theta, 2), "vega": round(vega, 2)}

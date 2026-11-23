"""Completed-candle FVG research helper; not connected to live trading."""

from dataclasses import dataclass
from math import isfinite
from statistics import mean

from services.aqte_engine import day, session


@dataclass(frozen=True)
class FVGConfig:
    atr_period: int = 14
    min_gap_ticks: float = 1.0
    tick_size: float = 0.05
    displacement_atr: float = 0.75
    displacement_body: float = 0.6
    max_age_bars: int = 12

    def __post_init__(self):
        if (type(self.atr_period) is not int or self.atr_period < 1
                or type(self.max_age_bars) is not int or self.max_age_bars < 0
                or not all(isfinite(x) and x > 0 for x in
                           (self.min_gap_ticks, self.tick_size, self.displacement_atr))
                or not isfinite(self.displacement_body) or not 0 < self.displacement_body <= 1):
            raise ValueError("Invalid FVG research configuration")


def detect_fvgs(bars, interval, as_of, config=FVGConfig()):
    """Find causal FVGs and their closed-candle lifecycle, without assigning an entry."""
    if type(interval) is not int or interval <= 0 or not isfinite(as_of):
        raise ValueError("Invalid candle interval or evaluation time")
    completed = []
    previous_at = None
    for bar in bars:
        at = bar["at"]
        if not isfinite(at):
            raise ValueError("Invalid candle timestamp")
        if at + interval > as_of or not session(at) or day(at) != day(as_of):
            continue
        prices = [bar[key] for key in ("open", "high", "low", "close")]
        if ((previous_at is not None and at <= previous_at)
                or not all(isfinite(price) and price > 0 for price in prices)
                or bar["low"] > min(bar["open"], bar["close"])
                or bar["high"] < max(bar["open"], bar["close"])):
            raise ValueError("Invalid or unordered candles")
        previous_at = at
        completed.append(bar)

    segments = []
    for bar in completed:
        if not segments or bar["at"] - segments[-1][-1]["at"] != interval:
            segments.append([])
        segments[-1].append(bar)

    zones = []
    for segment in segments:
        for i in range(config.atr_period + 2, len(segment)):
            first, middle, last = segment[i - 2:i + 1]
            history = segment[i - 2 - config.atr_period:i - 1]
            atr = mean(max(current["high"] - current["low"],
                           abs(current["high"] - previous["close"]),
                           abs(current["low"] - previous["close"]))
                       for previous, current in zip(history, history[1:]))
            candle_range = middle["high"] - middle["low"]
            body = middle["close"] - middle["open"]
            if (atr <= 0 or candle_range < config.displacement_atr * atr
                    or abs(body) < config.displacement_body * candle_range):
                continue
            minimum = config.min_gap_ticks * config.tick_size
            if body > 0 and last["low"] - first["high"] >= minimum:
                side, low, high = "BULLISH", first["high"], last["low"]
            elif body < 0 and first["low"] - last["high"] >= minimum:
                side, low, high = "BEARISH", last["high"], first["low"]
            else:
                continue
            state = "OPEN"
            touched_at = None
            midpoint_at = None
            invalidated_at = None
            for bar in segment[i + 1:]:
                touched = bar["low"] <= high if side == "BULLISH" else bar["high"] >= low
                midpoint = bar["low"] <= (low + high) / 2 if side == "BULLISH" else bar["high"] >= (low + high) / 2
                filled = bar["low"] <= low if side == "BULLISH" else bar["high"] >= high
                invalidated = bar["close"] < low if side == "BULLISH" else bar["close"] > high
                if touched and touched_at is None:
                    touched_at = bar["at"]
                if midpoint and midpoint_at is None:
                    midpoint_at = bar["at"]
                if invalidated:
                    state, invalidated_at = "INVALIDATED", bar["at"]
                    break
                if filled:
                    state = "FILLED"
                elif touched and state == "OPEN":
                    state = "PARTIAL"
            age = len(segment) - i - 1
            zones.append({
                "side": side, "low": low, "high": high, "atr": atr,
                "first_at": first["at"], "displacement_at": middle["at"],
                "formed_at": last["at"] + interval, "state": state,
                "touched_at": touched_at, "midpoint_at": midpoint_at,
                "invalidated_at": invalidated_at, "age_bars": age,
                "stale": age > config.max_age_bars,
                "continuity_lost": segment is not segments[-1],
            })
    expected = int(as_of // interval) * interval - interval
    ready = bool(segments and len(segments[-1]) >= config.atr_period + 3
                 and segments[-1][-1]["at"] == expected)
    return {"history_ready": ready, "zones": zones}

"""Independent QuantEdge Pro signal rules over completed shared market candles."""

import math
from dataclasses import asdict
from statistics import mean, pstdev

from services.aqte_engine import day, round_tick, session


def _finite(value):
    return isinstance(value, (int, float)) and math.isfinite(value)


def _rsi(closes, period=14):
    changes = [right - left for left, right in zip(closes, closes[1:])]
    if len(changes) < period:
        return None
    gains = [max(change, 0.0) for change in changes[-period:]]
    losses = [max(-change, 0.0) for change in changes[-period:]]
    average_gain, average_loss = mean(gains), mean(losses)
    if average_loss == 0:
        return 100.0 if average_gain else 50.0
    return 100 - 100 / (1 + average_gain / average_loss)


def evaluate_breakout(bars):
    """Return one completed-candle Super-Candle/Bollinger breakout decision and its exact rule results."""
    candles = list(bars)
    if len(candles) < 21:
        return {"decision": "WAIT", "reason": "Need 21 completed one-minute candles",
                "rules": {}, "candle_at": None}
    candles = candles[-21:]
    fields = ("open", "high", "low", "close", "volume")
    if any(not all(_finite(bar.get(field)) for field in fields) for bar in candles):
        return {"decision": "WAIT", "reason": "Completed candle data is incomplete or non-finite",
                "rules": {}, "candle_at": None}

    current = candles[-1]
    closes = [bar["close"] for bar in candles]
    prior_closes = closes[-21:-1]
    center, deviation = mean(prior_closes), pstdev(prior_closes)
    upper, lower = center + 2 * deviation, center - 2 * deviation
    true_ranges = []
    for previous, bar in zip(candles[-15:-1], candles[-14:]):
        true_ranges.append(max(bar["high"] - bar["low"],
                               abs(bar["high"] - previous["close"]),
                               abs(bar["low"] - previous["close"])))
    atr = mean(true_ranges) if true_ranges else None
    rsi = _rsi(closes)
    prior_volume = mean(bar["volume"] for bar in candles[:-1])
    candle_range = current["high"] - current["low"]
    body_ratio = abs(current["close"] - current["open"]) / candle_range if candle_range > 0 else 0
    close_position = (current["close"] - current["low"]) / candle_range if candle_range > 0 else 0
    volume_ratio = current["volume"] / prior_volume if prior_volume > 0 else None

    if atr is None or atr <= 0 or rsi is None:
        return {"decision": "WAIT", "reason": "ATR or RSI warmup is incomplete",
                "rules": {}, "candle_at": current["at"]}

    common = {
        "strong_body": body_ratio >= 0.65,
        "range_expansion": candle_range >= 1.2 * atr,
        "volume_expansion": volume_ratio is not None and volume_ratio >= 1.5,
    }
    candidates = []
    for side, direction, band, close_test, rsi_test in (
        ("CE", 1, upper, close_position >= 0.8, rsi >= 55),
        ("PE", -1, lower, close_position <= 0.2, rsi <= 45),
    ):
        rules = {
            "band_breakout": current["close"] > band if direction > 0 else current["close"] < band,
            "directional_candle": current["close"] > current["open"] if direction > 0
                else current["close"] < current["open"],
            "strong_body": common["strong_body"],
            "close_position": close_test,
            "range_expansion": common["range_expansion"],
            "volume_expansion": common["volume_expansion"],
            "rsi_confirmation": rsi_test,
        }
        candidates.append((side, rules))

    selected = next(((side, rules) for side, rules in candidates if all(rules.values())), None)
    reasons = []
    if not selected:
        for side, rules in candidates:
            failed = [name for name, passed in rules.items() if not passed]
            reasons.append(f"{side}: " + ", ".join(failed))
    return {
        "decision": f"BUY {selected[0]}" if selected else "WAIT",
        "side": selected[0] if selected else None,
        "reason": "All independent breakout rules passed" if selected else "; ".join(reasons),
        "rules": selected[1] if selected else {side: rules for side, rules in candidates},
        "candle_at": current["at"],
        "metrics": {
            "upper_band": upper,
            "lower_band": lower,
            "atr": atr,
            "rsi": rsi,
            "body_ratio": body_ratio,
            "close_position": close_position,
            "volume_ratio": volume_ratio,
        },
    }


def build_candidate(market, symbol, now, lots, busy, costs, max_risk=500):
    """Build a live option candidate from shared raw feed data, never from an AQTE signal."""
    with market.lock:
        engine = market.engine
        spot, future = engine.spot.get(symbol), engine.future.get(symbol)
        if not engine.fresh(spot, now) or not engine.fresh(future, now):
            return {"decision": "WAIT", "reason": "Fresh spot and futures ticks are required"}
        bars = [
            bar for bar in engine.book.closed.get(("future", future.token, 60), ())
            if bar["at"] + 60 <= now and session(bar["at"])
        ]
        signal = evaluate_breakout(bars)
        if signal.get("candle_at") is not None and (
            day(signal["candle_at"]) != day(now) or now - (signal["candle_at"] + 60) > 90
        ):
            return {"decision": "WAIT", "reason": "Awaiting a fresh completed one-minute candle",
                    "candle_at": signal["candle_at"]}
        if signal["decision"] != "BUY CE" and signal["decision"] != "BUY PE":
            return signal
        side = signal["side"]
        at = signal["candle_at"] + 60
        setup_key = f"QUANTEDGE:{symbol}:{int(signal['candle_at'])}:{side}"
        picked = engine.pick(symbol, side, now, spot, exclude=busy)
        if picked is None:
            return {**signal, "decision": "WAIT", "symbol": symbol, "signal_at": at, "setup_key": setup_key,
                    "reason": f"No fresh liquid {side} option contract is available"}
        _, contract, quote = picked
        quantity = contract.lot_size * lots
        if quote.ask_quantity < quantity:
            return {**signal, "decision": "WAIT", "symbol": symbol, "signal_at": at, "setup_key": setup_key,
                    "reason": f"Option ask depth is below the configured {lots}-lot quantity"}
        maximum = round_tick(quote.ask, contract.tick_size, up=True)
        stop = round_tick(max(contract.tick_size, maximum * 0.8), contract.tick_size)
        target = round_tick(maximum + 2 * (maximum - stop), contract.tick_size, up=True)
        if not 0 < stop < maximum < target:
            return {**signal, "decision": "WAIT", "symbol": symbol, "signal_at": at, "setup_key": setup_key,
                    "reason": "Option premium cannot form valid stop/target levels"}
        risk = (maximum - stop) * quantity + costs(maximum, quantity) + costs(stop, quantity)
        reward = (target - maximum) * quantity - costs(maximum, quantity) - costs(target, quantity)
        if risk > max_risk:
            return {**signal, "decision": "WAIT",
                    "symbol": symbol, "signal_at": at, "setup_key": setup_key,
                    "reason": f"Configured {lots} lots exceed INR {max_risk:g} per-trade risk cap",
                    "estimated_risk": round(risk, 2)}
        if risk <= 0 or reward / risk < 1.5:
            return {**signal, "decision": "WAIT", "symbol": symbol, "signal_at": at, "setup_key": setup_key,
                    "reason": "Net reward/risk after estimated costs is below 1.5"}
        entry = {
            "low": round_tick(quote.bid, contract.tick_size),
            "high": maximum,
            "maximum": maximum,
            "stop": stop,
            "target": target,
            "quantity": quantity,
            "reward_risk": round(reward / risk, 2),
        }
        return {
            **signal,
            "decision": f"BUY {side}",
            "symbol": symbol,
            "strategy": "super_candle_bollinger_breakout_v1",
            "contract": asdict(contract),
            "entry": entry,
            "risk": round(risk, 2),
            "spread_fraction": (quote.ask - quote.bid) / quote.ask,
            "signal_at": at,
            "setup_key": setup_key,
        }

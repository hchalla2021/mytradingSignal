"""Persisted live entry preferences and deterministic fail-closed quality gates."""

import math

from pydantic import BaseModel, ConfigDict, Field

from services.aqte_engine import SYMBOLS, day


class IndexControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(default=False, strict=True)
    max_trades: int = Field(default=5, ge=1, le=10, strict=True)
    min_confidence: int = Field(default=90, ge=90, le=100, strict=True)
    stop_percent: float = Field(default=20, ge=5, le=30, allow_inf_nan=False)
    target_rr: float = Field(default=2, ge=2, le=5, allow_inf_nan=False)
    trail_start_r: float = Field(default=1, ge=1, le=3, allow_inf_nan=False)
    daily_loss: float = Field(default=2000, gt=0, le=2000, allow_inf_nan=False)


def defaults():
    return {symbol: IndexControl().model_dump() for symbol in SYMBOLS}


def counts(state, now, symbol=None):
    entries = {}
    for trade in state["trades"]:
        if day(trade["entry_at"]) == day(now):
            entries[trade["id"]] = dict(symbol=trade["symbol"], filled=True)
    active = state["active"]
    if active and day(active["entry_at"]) == day(now):
        entries[active["id"]] = dict(symbol=active["symbol"], filled=active["filled"] > 0)
    for intent in state.get("daily_entries", []):
        if day(intent["at"]) == day(now):
            previous = entries.get(intent["id"], {})
            entries[intent["id"]] = {**intent, "filled": bool(intent["filled"] or previous.get("filled"))}
    selected = [entry for entry in entries.values() if symbol is None or entry["symbol"] == symbol]
    return dict(executed=sum(bool(e["filled"]) for e in selected),
                reserved=sum(not e["filled"] and e.get("pending", True) for e in selected))


def quality_reason(signal, control):
    if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
        return "No confirmed LONG CE/PE opportunity"
    score = signal.get("confidence")
    if not isinstance(score, (float, int)) or not math.isfinite(score) or score < control["min_confidence"]:
        return f'Rule score below {control["min_confidence"]}/100; do not trade'
    if signal.get("model_validated") is not True:
        return "Signal model has not passed paper validation"
    info = signal.get("intelligence") or {}
    side = 1 if signal["decision"] == "BUY CE" else -1
    try:
        ema = [float(info["ema"][str(period)]) for period in (9, 20, 50, 100, 200)]
        if not all(math.isfinite(v) for v in ema) or not all(
            side * (a - b) > 0 for a, b in zip(ema, ema[1:])
        ):
            return "EMA 9/20/50/100/200 are not directionally aligned"
        checks = (
            info["vwap"] is not None and side * (info["close"] - info["vwap"]) > 0,
            info["supertrend"] == ("BULLISH" if side > 0 else "BEARISH"),
            55 <= info["rsi"] <= 70 if side > 0 else 30 <= info["rsi"] <= 45,
            info["cpr"] is not None and side * (info["close"] - info["cpr"]["top" if side > 0 else "bottom"]) > 0,
            info["volume_ratio"] >= 1.5,
            info["imbalance"] is not None and side * info["imbalance"] >= 0.15,
            info["breakout"] == side,
            info["structure"] == ("HIGHER_HIGH" if side > 0 else "LOWER_LOW"),
        )
        if not all(checks):
            return "Directional breakout, volume, CPR, RSI or order-flow confirmation missing"
    except (KeyError, TypeError, ValueError):
        return "Incomplete market intelligence; WAIT"
    # These are intentionally not inferred from unrelated metrics or model scores.
    return "Validated option-chain OI/PCR/Greeks and liquidity-sweep confirmation are unavailable"

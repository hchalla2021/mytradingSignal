"""Persisted live entry preferences and deterministic fail-closed quality gates."""

import math
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from services.aqte_engine import SYMBOLS, day, directional_checks, scalp


class IndexControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(default=False, strict=True)
    # scalp: quick premium-point targets (10/20/30 NIFTY); swing: stop_percent / target_rr levels.
    style: Literal["scalp", "swing"] = "scalp"
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


def quality_reason(signal, control, allow_unvalidated_rules=False):
    """Strict mode always blocks; the explicit opt-in still requires every directional check."""
    if signal.get("decision") not in ("BUY CE", "BUY PE") or not signal.get("entry"):
        return "No confirmed LONG CE/PE opportunity"
    score = signal.get("confidence")
    if not isinstance(score, (float, int)) or not math.isfinite(score):
        return f'Rule score below {control["min_confidence"]}/100; do not trade'
    if not allow_unvalidated_rules:
        if score < control["min_confidence"]:
            return f'Rule score below {control["min_confidence"]}/100; do not trade'
        if signal.get("model_validated") is not True:
            return "Signal model has not passed paper validation"
    info = signal.get("intelligence") or {}
    if str(signal.get("strategy") or "").startswith("quick_scalp"):
        # Re-derive the scalp rules from the live intelligence; never trust the cached decision alone.
        setup, reason = scalp(info, signal["entry"].get("points_allowed") or ())
        if setup is None:
            return f"Quick-scalp rules no longer hold: {reason}"
        if setup["side"] != signal["decision"][-2:]:
            return "Quick-scalp direction changed; WAIT"
        if allow_unvalidated_rules:
            return None
        return "Validated option-chain OI/PCR/Greeks and liquidity-sweep confirmation are unavailable"
    for check in directional_checks(info, "CE" if signal["decision"] == "BUY CE" else "PE", "swing"):
        if check["passed"] is not True:
            if check["id"] == "ema":
                return check["reason"] if check["passed"] is False else "Incomplete market intelligence; WAIT"
            return f'{check["reason"]}; directional confirmation missing'
    if allow_unvalidated_rules:
        return None
    # These are intentionally not inferred from unrelated metrics or model scores.
    return "Validated option-chain OI/PCR/Greeks and liquidity-sweep confirmation are unavailable"

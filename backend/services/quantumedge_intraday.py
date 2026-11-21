"""Independent QuantumEdge IntraDay signal and event-AI service."""

from __future__ import annotations

import json
import logging
import math
import os
import threading
import time
from dataclasses import asdict
from statistics import mean
from typing import Any

import httpx

from services.aqte_engine import day, round_tick, session
from services.quantumedge_ml import QuantumEdgeML
from services.quantumedge_strategies import SPOT_STRATEGIES, previous_spot_levels, select_setup
from services.smc_engine import DISPLACEMENT_ATR, DISPLACEMENT_BODY, detect_fvgs

logger = logging.getLogger(__name__)
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
API_URL = "https://api.anthropic.com/v1/messages"
DAILY_LOSS_LIMIT = 1500
REVIEW_FORMAT = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["BUY_CE", "BUY_PE", "REJECT"]},
            "confidence": {"type": "number"},
            "reason": {"type": "string"},
        },
        "required": ["action", "confidence", "reason"],
        "additionalProperties": False,
    },
}


def _rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) <= period:
        return None
    changes = [b - a for a, b in zip(closes, closes[1:])][-period:]
    gains = [max(value, 0.0) for value in changes]
    losses = [max(-value, 0.0) for value in changes]
    average_gain, average_loss = mean(gains), mean(losses)
    if average_loss == 0:
        return 100.0 if average_gain else 50.0
    return 100 - 100 / (1 + average_gain / average_loss)


def _price_action(bars: list[dict[str, Any]], now: float) -> dict[str, Any] | None:
    recent = bars[-21:]
    current = recent[-1]
    if not 0 <= now - (current["at"] + 60) < 60 or any(
        b["at"] - a["at"] != 60 for a, b in zip(recent, recent[1:])
    ):
        return None
    prior = recent[:-1]
    atr = mean(max(b["high"] - b["low"], abs(b["high"] - a["close"]),
                   abs(b["low"] - a["close"]))
               for a, b in zip(prior[-15:], prior[-14:]))
    candle_range = current["high"] - current["low"]
    body = current["close"] - current["open"]
    structure = ("BULLISH" if current["close"] > max(b["high"] for b in prior[-5:])
                 else "BEARISH" if current["close"] < min(b["low"] for b in prior[-5:])
                 else "INSIDE_RANGE")
    displacement = ("BULLISH" if body > 0 else "BEARISH") if (
        atr > 0 and candle_range >= DISPLACEMENT_ATR * atr
        and abs(body) >= DISPLACEMENT_BODY * candle_range
    ) else None
    gap = next((gap for gap in detect_fvgs(recent, atr) if gap["state"] == "OPEN"), None)
    return {"structure": structure, "displacement": displacement, "fvg": gap,
            "candle_closed_at": current["at"] + 60}


class QuantumEdgeIntradayService:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.processed: set[str] = set()
        self.pending: dict[str, dict[str, Any]] = {}
        self.last_result: dict[str, dict[str, Any]] = {}
        self.approved: dict[str, dict[str, Any]] = {}
        self.last_error: str | None = None
        self.ai_calls = 0
        self.ai_cost_usd = 0.0
        self.ai_month = ""
        self.ai_month_cost_usd = 0.0
        self.ai_busy = False
        self.usage_day = ""
        self.ml = QuantumEdgeML()

    @staticmethod
    def enabled() -> bool:
        return os.getenv("QUANTUMEDGE_AI_ENABLED", "true").strip().lower() in {
            "1", "true", "yes", "on",
        }

    @staticmethod
    def model() -> str:
        return os.getenv("QUANTUMEDGE_AI_MODEL", "claude-haiku-5-5").strip()

    def evaluate(self, market, symbol: str, now: float, lots: int, risk_per_lot: float,
                 busy: set[int], costs, *, daily_budget: float | None = None) -> dict[str, Any]:
        with market.lock:
            engine = market.engine
            spot, future = engine.spot.get(symbol), engine.future.get(symbol)
            if not engine.fresh(spot, now) or not engine.fresh(future, now):
                return {"decision": "WAIT", "symbol": symbol, "reason": "Fresh spot and futures ticks required"}
            today = day(now)
            session_bars = [
                bar for bar in engine.book.closed.get(("future", future.token, 60), ())
                if bar["at"] + 60 <= now and session(bar["at"]) and day(bar["at"]) == today
            ]
            prior_spot = previous_spot_levels(engine.previous_day.get(symbol), today)
            spot_bars = engine.book.closed.get(("spot", spot.token, 60), ()) if prior_spot else ()
            latest_spot = (spot_bars[-2], spot_bars[-1]) if len(spot_bars) >= 2 else ()
            setup, reason = select_setup(session_bars, now, spot_bars=latest_spot, prior_spot=prior_spot)
            bars = session_bars[-50:]
            price_action = _price_action(bars, now) if len(bars) >= 21 else None
            if setup is None:
                return {"decision": "WAIT", "symbol": symbol, "price_action": price_action, "reason": reason}
            side = setup["side"]
            closes = [float(bar["close"]) for bar in bars]
            ema_fast = self._ema(closes, 9)
            ema_slow = self._ema(closes, 21)
            rsi = _rsi(closes)
            current = bars[-1]
            avg_volume = mean(float(bar["volume"]) for bar in bars[-21:-1])
            volume_ratio = float(current["volume"]) / avg_volume if avg_volume else 0.0
            candle_at = float(current["at"])
            setup_key = f"QUANTUMEDGE:{symbol}:{int(candle_at)}:{side}:{setup['id']}"
            identity = {"strategy": setup["id"], "strategy_name": setup["name"]}
            excluded = set(busy)
            first_rejection = None
            while True:
                picked = engine.pick(symbol, side, now, spot, exclude=excluded)
                if picked is None:
                    return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                            "price_action": price_action, **identity,
                            "reason": first_rejection or f"No liquid fresh {side} contract"}
                _, contract, quote = picked
                quantity = int(contract.lot_size) * lots
                maximum = round_tick(float(quote.ask), contract.tick_size, up=True)
                stop = round_tick(max(contract.tick_size, maximum * 0.8), contract.tick_size)
                target = round_tick(maximum + 2 * (maximum - stop), contract.tick_size, up=True)
                gross_loss = (maximum - stop) * quantity
                gross_profit = (target - maximum) * quantity
                entry_cost, stop_cost, target_cost = (
                    costs(price, quantity) for price in (maximum, stop, target)
                )
                risk = gross_loss + entry_cost + stop_cost
                reward = gross_profit - entry_cost - target_cost
                if int(quote.ask_quantity) < quantity:
                    rejection = "Option ask depth is below configured quantity"
                elif not 0 < stop < maximum < target or risk <= 0 or reward / risk < 1.5:
                    rejection = "Net reward/risk is below 1.5"
                elif risk > risk_per_lot * lots:
                    rejection = f"Estimated risk ₹{risk / lots:,.2f}/lot exceeds the ₹{risk_per_lot:,}/lot cap"
                elif daily_budget is not None and round(risk, 2) >= daily_budget:
                    rejection = f"Risk ₹{risk:,.2f} ≥ algo budget ₹{daily_budget:,.2f}"
                else:
                    break
                if not first_rejection:
                    first_rejection = rejection
                    if daily_budget is not None:
                        first_rejection = f"No eligible same-expiry {side} strike. Nearest: {rejection}"
                        excluded.update(c.token for c in engine.contracts.values() if c.expiry != contract.expiry)
                if daily_budget is not None:
                    excluded.add(contract.token)
                    continue
                return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                        "reason": rejection, "price_action": price_action, **identity}
            spread = (float(quote.ask) - float(quote.bid)) / float(quote.ask)
            ml_features = self.ml_features(
                symbol, side, bars, ema_fast, ema_slow, rsi, volume_ratio,
                spot.price, contract, quote, spread, reward / risk, now,
            ) if len(bars) >= 21 and rsi is not None and setup["id"] not in SPOT_STRATEGIES else ()
            return {
                "decision": f"BUY {side}", "side": side, "symbol": symbol,
                **identity,
                "strategy_evidence": setup["reason"],
                "contract": asdict(contract),
                "entry": {
                    "maximum": maximum, "stop": stop, "target": target, "quantity": quantity,
                    "reward_risk": round(reward / risk, 2),
                },
                "risk": round(risk, 2),
                "risk_breakdown": {
                    "gross_loss_at_stop_inr": round(gross_loss, 2),
                    "gross_profit_at_target_inr": round(gross_profit, 2),
                    "entry_cost_inr": round(entry_cost, 2),
                    "stop_exit_cost_inr": round(stop_cost, 2),
                    "target_exit_cost_inr": round(target_cost, 2),
                    "net_profit_at_target_inr": round(reward, 2),
                },
                "spread_fraction": spread,
                "price_action": price_action,
                "ml_features": ml_features,
                "signal_at": candle_at + 60,
                "setup_key": setup_key,
                "metrics": {"ema_fast": ema_fast, "ema_slow": ema_slow, "rsi": rsi,
                            "volume_ratio": volume_ratio},
                "rules": {
                    "completed_candle_setup": True,
                    "liquidity": True, "risk_reward": True,
                },
                "reason": ("QuantumEdge selected the next eligible same-expiry strike"
                           if first_rejection else setup["reason"]),
                "alternate_strike": first_rejection is not None,
            }

    @staticmethod
    def ml_features(symbol, side, bars, fast, slow, rsi, volume_ratio,
                    spot, contract, quote, spread, reward_risk, now):
        recent = bars[-21:]
        if not 0 <= now - (recent[-1]["at"] + 60) < 60 or any(
            b["at"] - a["at"] != 60 for a, b in zip(recent, recent[1:])
        ):
            return ()
        current, previous = recent[-1], recent[-2]
        close = current["close"]
        direction = 1 if side == "CE" else -1
        atr = mean(max(b["high"] - b["low"], abs(b["high"] - a["close"]),
                       abs(b["low"] - a["close"]))
                   for a, b in zip(recent[-15:], recent[-14:]))
        volume = sum(b["volume"] for b in recent)
        if min(atr, close, spot, volume) <= 0 or quote.bid_quantity < contract.lot_size:
            return ()
        vwap = sum((b["high"] + b["low"] + b["close"]) * b["volume"] / 3 for b in recent) / volume
        return (
            *(float(symbol == index) for index in SYMBOLS), float(side == "CE"),
            direction * (fast - slow) / close * 100, direction * (rsi - 50) / 50,
            volume_ratio, direction * (close - previous["high" if side == "CE" else "low"]) / atr,
            direction * (close - current["open"]) / atr, atr / close * 100,
            direction * (close - vwap) / atr,
            direction * (close - recent[-6]["close"]) / atr,
            direction * (close - recent[-16]["close"]) / atr,
            spread, math.log1p(quote.bid_quantity / contract.lot_size),
            math.log1p(quote.ask_quantity / contract.lot_size), quote.ask / spot * 100,
            direction * (spot - contract.strike) / spot * 100, reward_risk,
        )

    @staticmethod
    def _ema(values: list[float], period: int) -> float:
        alpha = 2 / (period + 1)
        current = values[0]
        for value in values[1:]:
            current = alpha * value + (1 - alpha) * current
        return current

    def review(self, candidate: dict[str, Any]) -> dict[str, Any]:
        key = str(candidate.get("setup_key") or "")
        with self.lock:
            if key in self.processed:
                return {"approved": False, "state": "DUPLICATE", "reason": "Signal already processed"}
            if self.ai_busy:
                return {"approved": False, "state": "PENDING", "reason": "AI validation in progress"}
            self.ai_busy = True
        try:
            ml = self.ml.assess(candidate, time.time())
            if not ml["allows_review"]:
                result = {"approved": False, "state": "ML_BLOCKED", "reason": ml["reason"], "attempted": False}
            else:
                # Claude reviews the market/risk evidence independently, not LightGBM's score.
                result = self._call_ai({
                    k: v for k, v in candidate.items()
                    if k not in ("ml_features", "advisory")
                })
            result = {**result, "ml": ml}
            with self.lock:
                if result.get("attempted"):
                    self.processed.add(key)
                if result.get("approved"):
                    self.approved[key] = {**candidate, "ml": ml}
                self.last_result[str(candidate.get("symbol"))] = result
                self.last_result[str(candidate.get("symbol"))]["setup_key"] = key
                self.last_error = result.get("reason") if result.get("state") == "AI_UNAVAILABLE" else None
            return result
        finally:
            with self.lock:
                self.ai_busy = False

    def _call_ai(self, candidate: dict[str, Any]) -> dict[str, Any]:
        key = (os.getenv("QUANTUMEDGE_AI_ANTHROPIC_API_KEY")
               or os.getenv("AUTONOMIQ_PRO_ANTHROPIC_API_KEY") or "").strip()
        if not key or not self.enabled():
            reason = "QuantumEdge AI is not configured or enabled"
            return {"approved": False, "state": "AI_UNAVAILABLE", "reason": reason, "attempted": False}
        today = day(time.time())
        with self.lock:
            if self.usage_day != today:
                self.usage_day, self.ai_calls, self.ai_cost_usd = today, 0, 0.0
            month = today[:7]
            if self.ai_month != month:
                self.ai_month, self.ai_month_cost_usd = month, 0.0
            daily = float(os.getenv("QUANTUMEDGE_AI_DAILY_BUDGET_USD", "2.5"))
            monthly = float(os.getenv("QUANTUMEDGE_AI_MONTHLY_BUDGET_USD", "50"))
        maximum_tokens = max(128, min(int(os.getenv("QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS", "256")), 1000))
        if self.ai_cost_usd + maximum_tokens * 0.5 / 1_000_000 > daily:
            return {"approved": False, "state": "AI_UNAVAILABLE", "reason": "Daily AI budget exhausted",
                    "attempted": False}
        if self.ai_month_cost_usd + maximum_tokens * 0.5 / 1_000_000 > monthly:
            return {"approved": False, "state": "AI_UNAVAILABLE", "reason": "Monthly AI budget exhausted",
                    "attempted": False}
        expected = "BUY_CE" if candidate.get("side") == "CE" else "BUY_PE"
        model = self.model()
        fast_review = model == "claude-haiku-5-5"
        body = {
            "model": model,
            "max_tokens": maximum_tokens,
            "system": [{"type": "text", "text": (
                "You validate one completed QuantumEdge intraday option signal. "
                "Use supplied evidence only to assess direction, liquidity and false-breakout risk. "
                "Entry, stop and target are premiums per unit. Python has already checked risk: "
                "risk is the estimated INR loss for the full quantity including entry and stop-exit costs; "
                "reward_risk is net profit after entry and target-exit costs divided by that loss. "
                "Use the supplied after-cost figures; do not infer risk from raw price distances "
                "or treat rounding differences as contradictions. Treat price_action as context only; "
                "null means unavailable. Approve only the exact expected_action, or REJECT. "
                "Return compact JSON: {\"action\":\"BUY_CE|BUY_PE|REJECT\","
                "\"confidence\":0-100,\"reason\":\"<=12 words\"}."
            )}],
            "messages": [{"role": "user", "content": json.dumps({
                "candidate": candidate, "expected_action": expected,
            }, separators=(",", ":"), default=str)}],
            "output_config": {"effort": "low", **({"format": REVIEW_FORMAT} if fast_review else {})},
        }
        if fast_review:
            body["thinking"] = {"type": "disabled"}
        try:
            response = httpx.post(API_URL, headers={
                "x-api-key": key, "anthropic-version": "2026-10-21" if fast_review else "2023-06-01",
                "content-type": "application/json",
            }, json=body, timeout=float(os.getenv("QUANTUMEDGE_AI_TIMEOUT_SECONDS", "12")))
        except httpx.TimeoutException:
            return self._review_error("Claude review timed out")
        except httpx.TransportError:
            return self._review_error("Could not reach Claude for review")
        if response.status_code != 200:
            return self._review_error(f"Claude review unavailable (HTTP {response.status_code})")
        try:
            data = response.json()
            if not isinstance(data, dict):
                raise ValueError("Invalid response envelope")
            usage = data.get("usage", {})
            if not isinstance(usage, dict):
                raise ValueError("Invalid usage metadata")
            cost = ((int(usage.get("input_tokens") or 0)
                     + int(usage.get("cache_read_input_tokens") or 0) * .1
                     + int(usage.get("cache_creation_input_tokens") or 0) * 1.25) * .1
                    + int(usage.get("output_tokens") or 0) * .5) / 1_000_000
            with self.lock:
                self.ai_calls += 1
                self.ai_cost_usd += cost
                self.ai_month_cost_usd += cost
            if data.get("stop_reason") == "max_tokens":
                return self._review_error("Claude review ended before a complete decision")
            if data.get("stop_reason") == "refusal":
                return self._review_error("Claude did not provide a trade review")
            if data.get("stop_reason") != "end_turn":
                return self._review_error("Claude did not complete the trade review")
            blocks = data.get("content")
            if not isinstance(blocks, list):
                raise ValueError("Invalid content blocks")
            text = "".join(block["text"] for block in blocks
                           if isinstance(block, dict) and block.get("type") == "text"
                           and isinstance(block.get("text"), str)).strip()
            if text.startswith("```") and text.endswith("```"):
                text = text.partition("\n")[2][:-3].strip()
            parsed = json.loads(text)
            if not isinstance(parsed, dict) or set(parsed) != {"action", "confidence", "reason"}:
                raise ValueError("Invalid decision object")
            action, confidence, reason = parsed.get("action"), parsed.get("confidence"), parsed.get("reason")
            if (action not in (expected, "REJECT") or type(confidence) not in (int, float)
                    or not 0 <= confidence <= 100 or not isinstance(reason, str) or not reason.strip()):
                raise ValueError("Invalid decision fields")
            return {
                "approved": action == expected,
                "state": "APPROVED" if action == expected else "REJECTED",
                "action": action, "confidence": confidence,
                "reason": reason.strip()[:180],
                "attempted": True,
            }
        except (ValueError, TypeError, OverflowError):
            return self._review_error("Claude returned an invalid decision")

    @staticmethod
    def _review_error(reason: str) -> dict[str, Any]:
        logger.warning("QuantumEdge AI review unavailable: %s", reason)
        return {"approved": False, "state": "AI_UNAVAILABLE", "reason": reason, "attempted": True}

    def status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "enabled": self.enabled(), "model": self.model(), "busy": self.ai_busy,
                "daily_calls": self.ai_calls, "daily_cost_usd": round(self.ai_cost_usd, 6),
                "monthly_cost_usd": round(self.ai_month_cost_usd, 6),
                "processed": len(self.processed), "last_error": self.last_error,
                "last_result": {symbol: dict(value) for symbol, value in self.last_result.items()},
                "ml": self.ml.status(time.time()),
            }

    def approved_candidates(self, now: float) -> list[dict[str, Any]]:
        with self.lock:
            expired = [
                key for key, candidate in self.approved.items()
                if now - float(candidate.get("signal_at") or 0) > 180
            ]
            for key in expired:
                self.approved.pop(key, None)
            return [dict(candidate) for candidate in self.approved.values()]

    def consume_approved(self, setup_key: str) -> None:
        with self.lock:
            self.approved.pop(setup_key, None)

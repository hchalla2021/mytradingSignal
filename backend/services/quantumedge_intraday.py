"""Independent QuantumEdge IntraDay signal and event-AI service."""

from __future__ import annotations

import json
import math
import os
import threading
import time
from dataclasses import asdict
from statistics import mean
from typing import Any

import httpx

from services.aqte_engine import day, round_tick, session

SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
API_URL = "https://api.anthropic.com/v1/messages"


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

    @staticmethod
    def enabled() -> bool:
        return os.getenv("QUANTUMEDGE_AI_ENABLED", "true").strip().lower() in {
            "1", "true", "yes", "on",
        }

    @staticmethod
    def model() -> str:
        return os.getenv("QUANTUMEDGE_AI_MODEL", "claude-haiku-5-5").strip()

    def evaluate(self, market, symbol: str, now: float, lots: int, risk_per_lot: float,
                 busy: set[int], costs) -> dict[str, Any]:
        with market.lock:
            engine = market.engine
            spot, future = engine.spot.get(symbol), engine.future.get(symbol)
            if not engine.fresh(spot, now) or not engine.fresh(future, now):
                return {"decision": "WAIT", "symbol": symbol, "reason": "Fresh spot and futures ticks required"}
            bars = [
                bar for bar in engine.book.closed.get(("future", future.token, 60), ())
                if bar["at"] + 60 <= now and session(bar["at"]) and day(bar["at"]) == day(now)
            ][-50:]
            if len(bars) < 21:
                return {"decision": "WAIT", "symbol": symbol, "reason": "Need 21 completed one-minute candles"}
            closes = [float(bar["close"]) for bar in bars]
            ema_fast = self._ema(closes, 9)
            ema_slow = self._ema(closes, 21)
            rsi = _rsi(closes)
            current, previous = bars[-1], bars[-2]
            if day(float(current["at"])) != day(now):
                return {"decision": "WAIT", "symbol": symbol,
                        "reason": "No completed candle from today's session"}
            body = abs(float(current["close"]) - float(current["open"]))
            prior_volumes = [float(bar["volume"]) for bar in bars[-21:-1]]
            volume_ratio = float(current["volume"]) / mean(prior_volumes) if mean(prior_volumes) else 0.0
            bullish = float(current["close"]) > ema_fast > ema_slow and float(current["close"]) > float(previous["high"])
            bearish = float(current["close"]) < ema_fast < ema_slow and float(current["close"]) < float(previous["low"])
            if not bullish and not bearish:
                return {"decision": "WAIT", "symbol": symbol, "reason": "Trend and breakout are not aligned"}
            if (rsi is None or bullish and rsi < 55 or bearish and rsi > 45
                    or volume_ratio < 1.2 or body <= 0):
                return {"decision": "WAIT", "symbol": symbol, "reason": "Momentum or volume confirmation failed"}
            side = "CE" if bullish else "PE"
            candle_at = float(current["at"])
            setup_key = f"QUANTUMEDGE:{symbol}:{int(candle_at)}:{side}"
            picked = engine.pick(symbol, side, now, spot, exclude=busy)
            if picked is None:
                return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                        "reason": f"No liquid fresh {side} contract"}
            _, contract, quote = picked
            quantity = int(contract.lot_size) * lots
            if int(quote.ask_quantity) < quantity:
                return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                        "reason": "Option ask depth is below configured quantity"}
            maximum = round_tick(float(quote.ask), contract.tick_size, up=True)
            stop = round_tick(max(contract.tick_size, maximum * 0.8), contract.tick_size)
            target = round_tick(maximum + 2 * (maximum - stop), contract.tick_size, up=True)
            risk = (maximum - stop) * quantity + costs(maximum, quantity) + costs(stop, quantity)
            reward = (target - maximum) * quantity - costs(maximum, quantity) - costs(target, quantity)
            if risk > risk_per_lot * lots:
                return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                        "reason": "Configured risk per lot would be exceeded"}
            if risk <= 0 or reward / risk < 1.5:
                return {"decision": "WAIT", "symbol": symbol, "setup_key": setup_key,
                        "reason": "Net reward/risk is below 1.5"}
            return {
                "decision": f"BUY {side}", "side": side, "symbol": symbol,
                "strategy": "quantumedge_multiframe_breakout_v1",
                "contract": asdict(contract),
                "entry": {
                    "maximum": maximum, "stop": stop, "target": target, "quantity": quantity,
                    "reward_risk": round(reward / risk, 2),
                },
                "risk": round(risk, 2),
                "spread_fraction": (float(quote.ask) - float(quote.bid)) / float(quote.ask),
                "signal_at": candle_at + 60,
                "setup_key": setup_key,
                "metrics": {"ema_fast": ema_fast, "ema_slow": ema_slow, "rsi": rsi,
                            "volume_ratio": volume_ratio},
                "rules": {
                    "trend_alignment": True, "completed_candle_breakout": True,
                    "rsi_confirmation": True, "volume_confirmation": True,
                    "liquidity": True, "risk_reward": True,
                },
                "reason": "QuantumEdge independent signal qualified",
            }

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
            result = self._call_ai(candidate)
            with self.lock:
                if result.get("attempted"):
                    self.processed.add(key)
                if result.get("approved"):
                    self.approved[key] = candidate
                self.last_result[str(candidate.get("symbol"))] = result
                self.last_result[str(candidate.get("symbol"))]["setup_key"] = key
                self.last_error = result.get("reason") if not result.get("approved") else None
            return result
        finally:
            with self.lock:
                self.ai_busy = False

    def _call_ai(self, candidate: dict[str, Any]) -> dict[str, Any]:
        key = (os.getenv("QUANTUMEDGE_AI_ANTHROPIC_API_KEY")
               or os.getenv("AUTONOMIQ_PRO_ANTHROPIC_API_KEY") or "").strip()
        if not key or not self.enabled():
            reason = "QuantumEdge AI is not configured or enabled"
            return {"approved": False, "state": "PENDING", "reason": reason, "attempted": False}
        today = day(time.time())
        with self.lock:
            if self.usage_day != today:
                self.usage_day, self.ai_calls, self.ai_cost_usd = today, 0, 0.0
            month = today[:7]
            if self.ai_month != month:
                self.ai_month, self.ai_month_cost_usd = month, 0.0
            daily = float(os.getenv("QUANTUMEDGE_AI_DAILY_BUDGET_USD", "2.5"))
            monthly = float(os.getenv("QUANTUMEDGE_AI_MONTHLY_BUDGET_USD", "50"))
        maximum_tokens = int(os.getenv("QUANTUMEDGE_AI_MAX_OUTPUT_TOKENS", "256"))
        if self.ai_cost_usd + maximum_tokens * 0.5 / 1_000_000 > daily:
            return {"approved": False, "state": "REJECTED", "reason": "Daily AI budget exhausted",
                    "attempted": False}
        if self.ai_month_cost_usd + maximum_tokens * 0.5 / 1_000_000 > monthly:
            return {"approved": False, "state": "REJECTED", "reason": "Monthly AI budget exhausted",
                    "attempted": False}
        expected = "BUY_CE" if candidate.get("side") == "CE" else "BUY_PE"
        body = {
            "model": self.model(),
            "max_tokens": max(128, min(maximum_tokens, 1000)),
            "system": [{"type": "text", "text": (
                "You validate one completed QuantumEdge intraday option signal. "
                "Use supplied evidence only. Check direction, entry, stop, target, reward/risk, "
                "liquidity and false-signal risk. Approve only an exact expected_action match. "
                "Return compact JSON: {\"action\":\"BUY_CE|BUY_PE|REJECT\","
                "\"confidence\":0-100,\"reason\":\"<=12 words\"}."
            )}],
            "messages": [{"role": "user", "content": json.dumps({
                "candidate": candidate, "expected_action": expected,
            }, separators=(",", ":"), default=str)}],
            "output_config": {"effort": "low"},
        }
        try:
            response = httpx.post(API_URL, headers={
                "x-api-key": key, "anthropic-version": "2023-06-01",
                "content-type": "application/json",
            }, json=body, timeout=float(os.getenv("QUANTUMEDGE_AI_TIMEOUT_SECONDS", "12")))
            if response.status_code != 200:
                return {"approved": False, "state": "REJECTED",
                        "reason": f"AI HTTP {response.status_code}", "attempted": True}
            data = response.json()
            text = "".join(block.get("text", "") for block in data.get("content", [])
                           if block.get("type") == "text")
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end <= start:
                raise ValueError("AI response did not contain JSON")
            parsed = json.loads(text[start:end + 1])
            action = str(parsed.get("action", "REJECT")).upper().replace(" ", "_")
            confidence = max(0.0, min(100.0, float(parsed.get("confidence", 0))))
            usage = data.get("usage") or {}
            cost = ((int(usage.get("input_tokens") or 0)
                     + int(usage.get("cache_read_input_tokens") or 0) * .1
                     + int(usage.get("cache_creation_input_tokens") or 0) * 1.25) * .1
                    + int(usage.get("output_tokens") or 0) * .5) / 1_000_000
            with self.lock:
                self.ai_calls += 1
                self.ai_cost_usd += cost
                self.ai_month_cost_usd += cost
            return {
                "approved": action == expected,
                "state": "APPROVED" if action == expected else "REJECTED",
                "action": action, "confidence": confidence,
                "reason": str(parsed.get("reason", "AI event validation"))[:180],
                "attempted": True,
            }
        except (httpx.TimeoutException, httpx.TransportError, ValueError, json.JSONDecodeError) as exc:
            return {"approved": False, "state": "REJECTED",
                    "reason": type(exc).__name__, "attempted": True}

    def status(self) -> dict[str, Any]:
        with self.lock:
            return {
                "enabled": self.enabled(), "model": self.model(), "busy": self.ai_busy,
                "daily_calls": self.ai_calls, "daily_cost_usd": round(self.ai_cost_usd, 6),
                "monthly_cost_usd": round(self.ai_month_cost_usd, 6),
                "processed": len(self.processed), "last_error": self.last_error,
                "last_result": {symbol: dict(value) for symbol, value in self.last_result.items()},
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

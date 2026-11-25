"""Cost-optimized QuantEdge signal approval pipeline."""

from __future__ import annotations

import copy
import json
import math
import os
import threading
import time
from collections import OrderedDict
from typing import Any, Callable

import httpx

from services.cache import get_cache


MARKET_CONTEXT_TTL_SECONDS = 300
PENDING_SIGNAL_TTL_SECONDS = 180
MODEL = "claude-fable-5-2"
API_URL = "https://api.anthropic.com/v1/messages"


class QuantEdgeHybridOrchestrator:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.pending: OrderedDict[str, dict[str, Any]] = OrderedDict()
        self.used: set[str] = set()
        self.ai_busy = False
        self.ai_slot: str | None = None
        self.ai_usage = {"day": "", "month": "", "calls": 0, "cost_usd": 0.0}
        self.last_error: str | None = None
        self.last_ai_at: float | None = None

    def _day(self, now: float) -> str:
        import datetime
        return datetime.datetime.fromtimestamp(now).strftime("%Y-%m-%d")

    def _month(self, now: float) -> str:
        import datetime
        return datetime.datetime.fromtimestamp(now).strftime("%Y-%m")

    def _five_minute_slot(self, now: float) -> str:
        return time.strftime("%Y-%m-%dT%H:%M:00", time.localtime(now - (now % 300)))

    def _budget(self) -> tuple[float, float, float]:
        daily = float(os.getenv("AI_DAILY_BUDGET_USD") or "1.25")
        monthly = float(os.getenv("AI_MONTHLY_BUDGET_USD") or "25")
        max_tokens = float(os.getenv("AI_MAX_OUTPUT_TOKENS") or "180")
        return max(0.0, daily), max(0.0, monthly), max(64.0, min(max_tokens, 500.0))

    def status(self, now: float) -> dict[str, Any]:
        with self.lock:
            self._expire(now)
            day = self._day(now)
            month = self._month(now)
            if self.ai_usage["day"] != day:
                self.ai_usage = {"day": day, "month": month, "calls": 0, "cost_usd": 0.0}
            elif self.ai_usage["month"] != month:
                self.ai_usage["month"] = month
                self.ai_usage["calls"] = 0
                self.ai_usage["cost_usd"] = 0.0
            return {
                "enabled": (os.getenv("AI_ENABLED") or "true").strip().lower() in ("1", "true", "yes", "on"),
                "model": MODEL,
                "busy": self.ai_busy,
                "pending": len(self.pending),
                "deduplicated": len(self.used),
                "ai_slot": self.ai_slot,
                "last_ai_at": self.last_ai_at,
                "last_error": self.last_error,
                "daily_calls": self.ai_usage["calls"],
                "daily_cost_usd": round(self.ai_usage["cost_usd"], 6),
            }

    def _expire(self, now: float) -> None:
        expired = [key for key, item in self.pending.items()
                   if not item.get("expires_at") or item["expires_at"] < now]
        for key in expired:
            self.pending.pop(key, None)

    def market_context(self, candidates: dict[str, dict[str, Any]], now: float) -> dict[str, Any]:
        cache = get_cache()
        slot = self._five_minute_slot(now)
        key = f"quantedge:market-intelligence:{slot}"
        cached = cache.get_sync(key)
        if isinstance(cached, dict) and cached.get("expires_at", 0) > now:
            context = copy.deepcopy(cached)
        else:
            context = {
                "generated_at": now,
                "expires_at": now + MARKET_CONTEXT_TTL_SECONDS,
                "slot": slot,
                "indices": {
                    symbol: {
                        "decision": candidate.get("decision"),
                        "side": candidate.get("side"),
                        "candle_at": candidate.get("candle_at"),
                        "signal_at": candidate.get("signal_at"),
                        "metrics": candidate.get("metrics"),
                        "risk": candidate.get("risk"),
                        "spread_fraction": candidate.get("spread_fraction"),
                        "reward_risk": (candidate.get("entry") or {}).get("reward_risk"),
                        "reason": candidate.get("reason"),
                    }
                    for symbol, candidate in candidates.items()
                },
                "data_source": "Zerodha shared feed; completed candles; futures; option chain",
            }
            cache.set_sync(key, context, expire=MARKET_CONTEXT_TTL_SECONDS)
        context["fresh_changes"] = {
            symbol: {
                "decision": candidate.get("decision"),
                "side": candidate.get("side"),
                "signal_at": candidate.get("signal_at"),
                "metrics": candidate.get("metrics"),
                "reason": candidate.get("reason"),
            }
            for symbol, candidate in candidates.items()
        }
        return context

    def submit(self, candidate: dict[str, Any], now: float,
               revalidate: Callable[[dict[str, Any], float], dict[str, Any]]) -> dict[str, Any]:
        if candidate.get("decision") not in ("BUY CE", "BUY PE"):
            return {"approved": False, "reason": "No local BUY setup", "state": "WAIT"}

        setup_key = str(candidate.get("setup_key") or "")
        signal_at = candidate.get("signal_at")
        if not setup_key or not isinstance(signal_at, (int, float)):
            return {"approved": False, "reason": "Candidate identity or signal time unavailable", "state": "WAIT"}
        if now - float(signal_at) > PENDING_SIGNAL_TTL_SECONDS:
            return {"approved": False, "reason": "Stale QuantEdge signal", "state": "STALE"}

        with self.lock:
            if setup_key in self.used:
                return {"approved": False, "reason": "Duplicate setup already handled", "state": "DUPLICATE"}
            fresh = revalidate(candidate, now)
            if fresh.get("decision") not in ("BUY CE", "BUY PE"):
                return {"approved": False, "reason": fresh.get("reason") or "Fresh local revalidation failed",
                        "state": "WAIT"}
            if now - float(fresh.get("signal_at") or now) > PENDING_SIGNAL_TTL_SECONDS:
                return {"approved": False, "reason": "Signal expired during revalidation", "state": "STALE"}
            item = {
                "candidate": copy.deepcopy(fresh),
                "queued_at": now,
                "expires_at": now + PENDING_SIGNAL_TTL_SECONDS,
                "priority": (
                    float((fresh.get("entry") or {}).get("reward_risk") or 0),
                    -float(fresh.get("risk") or 0),
                    float((fresh.get("metrics") or {}).get("volume_ratio") or 0),
                ),
            }
            self.pending[setup_key] = item

        result = self.approve_next(now)
        if result.get("approved") and result.get("setup_key") == setup_key:
            return result
        if result.get("state") in ("REJECTED", "STALE", "DUPLICATE"):
            return result
        return {"approved": False, "reason": result.get("reason") or "Qualified signal retained for revalidation",
                "state": "PENDING", "setup_key": setup_key}

    def approve_next(self, now: float) -> dict[str, Any]:
        with self.lock:
            self._expire(now)
            if not self.pending:
                return {"approved": False, "reason": "No pending QuantEdge signals", "state": "WAIT"}
            if self.ai_busy:
                return {"approved": False, "reason": "AI approval is busy", "state": "PENDING"}
            enabled = (os.getenv("AI_ENABLED") or "true").strip().lower() in ("1", "true", "yes", "on")
            if not enabled:
                return {"approved": False, "reason": "QuantEdge AI approval is disabled", "state": "PENDING"}
            slot = self._five_minute_slot(now)
            if self.ai_slot == slot:
                return {"approved": False, "reason": "AI already consumed this 5-minute slot", "state": "PENDING"}
            key, item = max(self.pending.items(), key=lambda pair: pair[1]["priority"])
            candidate = item["candidate"]
            expected = "BUY_CE" if candidate.get("side") == "CE" else "BUY_PE"
            context = self.market_context({str(candidate.get("symbol")): candidate}, now)
            try:
                self.ai_busy = True
                approval = self._call_ai(candidate, context)
            finally:
                self.ai_busy = False
            if approval.get("approved"):
                action = approval.get("action")
                if action != expected:
                    self.pending.pop(key, None)
                    self.used.add(key)
                    self.ai_slot = slot
                    return {"approved": False, "reason": "AI direction conflicts with QuantEdge", "state": "REJECTED"}
                self.pending.pop(key, None)
                self.used.add(key)
                self.ai_slot = slot
                self.last_ai_at = now
                return {**approval, "approved": True, "setup_key": key, "state": "APPROVED",
                        "candidate": candidate}
            self.last_ai_at = now
            if approval.get("state") == "PENDING" and not approval.get("attempted"):
                return {**approval, "approved": False, "setup_key": key, "state": "PENDING"}
            if approval.get("state") == "PENDING":
                self.ai_slot = slot
                return {**approval, "approved": False, "setup_key": key, "state": "PENDING"}
            self.ai_slot = slot
            self.pending.pop(key, None)
            self.used.add(key)
            return {**approval, "approved": False, "setup_key": key, "state": approval.get("state") or "REJECTED"}

    def _call_ai(self, candidate: dict[str, Any], context: dict[str, Any]) -> dict[str, Any]:
        api_key = os.getenv("ANTHROPIC_API_KEY", "").strip()
        if not api_key:
            self.last_error = "Anthropic API key unavailable"
            return {"approved": False, "reason": self.last_error, "state": "PENDING", "attempted": False}

        daily, monthly, max_tokens = self._budget()
        now = time.time()
        day = self._day(now)
        month = self._month(now)
        if self.ai_usage["day"] != day:
            self.ai_usage = {"day": day, "month": month, "calls": 0, "cost_usd": 0.0}
        worst_case_usd = max_tokens * 40.0 / 1_000_000
        if self.ai_usage["cost_usd"] + worst_case_usd > daily:
            self.last_error = "QuantEdge AI daily budget exhausted"
            return {"approved": False, "reason": self.last_error, "state": "PENDING", "attempted": False}
        if self.ai_usage["cost_usd"] + worst_case_usd > monthly:
            self.last_error = "QuantEdge AI monthly budget exhausted"
            return {"approved": False, "reason": self.last_error, "state": "PENDING", "attempted": False}

        expected = "BUY_CE" if candidate.get("side") == "CE" else "BUY_PE"
        system = (
            "You are the lightweight event validator for QuantEdge Pro. "
            "Use only supplied evidence. Never invent prices or market facts. "
            "Approve only if the fresh evidence supports the exact QuantEdge direction. "
            "Prefer REJECT on conflict, stale evidence, or insufficient room. "
            "Return JSON only."
        )
        payload = {
            "candidate": {
                "symbol": candidate.get("symbol"),
                "expected_action": expected,
                "strategy": candidate.get("strategy"),
                "signal_at": candidate.get("signal_at"),
                "metrics": candidate.get("metrics"),
                "entry": candidate.get("entry"),
                "risk": candidate.get("risk"),
                "spread_fraction": candidate.get("spread_fraction"),
            },
            "shared_market_context": context,
        }
        body = {
            "model": os.getenv("AI_MODEL") or MODEL,
            "max_tokens": int(max_tokens),
            "system": [{"type": "text", "text": system}],
            "messages": [{"role": "user", "content": json.dumps(payload, separators=(",", ":"), default=str)}],
            "output_config": {"effort": "low"},
        }
        headers = {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }
        try:
            response = httpx.post(API_URL, headers=headers, json=body, timeout=float(os.getenv(
                "AI_TIMEOUT_SECONDS") or "20"))
            if response.status_code != 200:
                self.last_error = f"HTTP {response.status_code}: {response.text[:160]}"
                return {"approved": False, "reason": self.last_error, "state": "PENDING", "attempted": True}
            data = response.json()
            text = "".join(block.get("text", "") for block in data.get("content", [])
                           if block.get("type") == "text")
            start, end = text.find("{"), text.rfind("}")
            if start < 0 or end < start:
                raise ValueError("AI response did not contain JSON")
            parsed = json.loads(text[start:end + 1])
            action = str(parsed.get("action", "REJECT")).upper().replace(" ", "_")
            usage = data.get("usage") or {}
            input_tokens = int(usage.get("input_tokens") or 0)
            output_tokens = int(usage.get("output_tokens") or 0)
            cache_read = int(usage.get("cache_read_input_tokens") or 0)
            cache_write = int(usage.get("cache_creation_input_tokens") or 0)
            cost = ((input_tokens + cache_write * 1.25 + cache_read * 0.1) * 8.0
                    + output_tokens * 40.0) / 1_000_000
            self.ai_usage["calls"] += 1
            self.ai_usage["cost_usd"] += cost
            self.last_error = None
            approved = action == expected
            return {
                "approved": approved,
                "action": action,
                "reason": str(parsed.get("reason", "AI event approval"))[:300],
                "confidence": max(0.0, min(100.0, float(parsed.get("confidence", 0)))),
                "state": "APPROVED" if approved else "REJECTED",
                "attempted": True,
            }
        except (httpx.TimeoutException, httpx.TransportError, ValueError, json.JSONDecodeError) as exc:
            self.last_error = f"{type(exc).__name__}"
            return {"approved": False, "reason": self.last_error, "state": "PENDING", "attempted": True}

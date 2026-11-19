"""Anthropic Messages API client for AUTONOMIQ PRO with USD budget, retry and circuit-breaker controls.

The API key is read from backend/.env (AUTONOMIQ_PRO_ANTHROPIC_API_KEY) and is never
logged, persisted, or returned to the browser.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any

import httpx

from .config import AutonomiqConfig
from .store import Store

logger = logging.getLogger(__name__)
API_URL = "https://api.anthropic.com/v1/messages"
RETRYABLE = {408, 409, 429, 500, 502, 503, 504, 529}
CIRCUIT_THRESHOLD = 3
CIRCUIT_COOLDOWN_S = 600
CACHE_READ_FACTOR, CACHE_WRITE_FACTOR = 0.1, 1.25


class AIUnavailable(Exception):
    """Raised when the AI layer must not or cannot be used; callers fall back safely."""


def extract_json(text: str) -> dict:
    cleaned = re.sub(r"^```(?:json)?|```$", "", text.strip(), flags=re.MULTILINE).strip()
    start, end = cleaned.find("{"), cleaned.rfind("}")
    if start < 0 or end <= start:
        raise ValueError("AI response contained no JSON object")
    return json.loads(cleaned[start:end + 1])


def call_cost(cfg: AutonomiqConfig, model: str, usage: dict) -> float:
    price_in, price_out = cfg.price(model)
    return (int(usage.get("input_tokens") or 0) * price_in
            + int(usage.get("cache_read_input_tokens") or 0) * price_in * CACHE_READ_FACTOR
            + int(usage.get("cache_creation_input_tokens") or 0) * price_in * CACHE_WRITE_FACTOR
            + int(usage.get("output_tokens") or 0) * price_out) / 1_000_000


class AIClient:
    def __init__(self, store: Store, transport: httpx.AsyncBaseTransport | None = None):
        self.store = store
        self.transport = transport
        self.consecutive_failures = 0
        self.circuit_open_until = 0.0
        self.authentication_failed = False
        self.last_call_at = 0.0
        self.last_error: str | None = None

    def status(self, cfg: AutonomiqConfig, day: str) -> str:
        if not cfg.ai_enabled:
            return "DISABLED"
        if not cfg.ai_configured:
            return "NOT_CONFIGURED"
        if time.time() < self.circuit_open_until:
            return "AI_AUTHENTICATION_FAILED" if self.authentication_failed else "CIRCUIT_OPEN"
        if self.store.ai_usage(day)["cost_usd"] >= cfg.daily_budget_usd:
            return "DAILY_BUDGET_EXHAUSTED"
        if self.store.ai_usage(day[:7])["cost_usd"] >= cfg.monthly_budget_usd:
            return "MONTHLY_BUDGET_EXHAUSTED"
        return "ACTIVE"

    def _guard(self, cfg: AutonomiqConfig, day: str, model: str, prompt_chars: int) -> None:
        state = self.status(cfg, day)
        if state != "ACTIVE":
            raise AIUnavailable(state)
        price_in, price_out = cfg.price(model)
        worst_case = ((prompt_chars / 3) * price_in + cfg.max_output_tokens * price_out) / 1_000_000
        if self.store.ai_usage(day)["cost_usd"] + worst_case > cfg.daily_budget_usd:
            raise AIUnavailable("DAILY_BUDGET_INSUFFICIENT")
        if self.store.ai_usage(day[:7])["cost_usd"] + worst_case > cfg.monthly_budget_usd:
            raise AIUnavailable("MONTHLY_BUDGET_INSUFFICIENT")

    def preflight(self, cfg: AutonomiqConfig, day: str, model: str, system: str,
                  payload: dict[str, Any]) -> None:
        user = json.dumps(payload, separators=(",", ":"), default=str)
        self._guard(cfg, day, model, len(system) + len(user))

    async def complete_json(self, cfg: AutonomiqConfig, day: str, agent: str, model: str, system: str,
                            payload: dict[str, Any]) -> dict:
        user = json.dumps(payload, separators=(",", ":"), default=str)
        self._guard(cfg, day, model, len(system) + len(user))
        system_block: dict[str, Any] = {"type": "text", "text": system}
        if cfg.prompt_cache:
            system_block["cache_control"] = {"type": "ephemeral"}
        body: dict[str, Any] = {
            "model": model, "max_tokens": cfg.max_output_tokens, "system": [system_block],
            "messages": [{"role": "user", "content": user}],
        }
        if cfg.reasoning_effort != "default":
            body["output_config"] = {"effort": cfg.reasoning_effort}
        headers = {"x-api-key": cfg.api_key, "anthropic-version": cfg.api_version, "content-type": "application/json"}

        attempt = 0
        while True:
            started = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=cfg.ai_timeout_seconds, transport=self.transport) as client:
                    response = await client.post(API_URL, headers=headers, json=body)
                latency = int((time.monotonic() - started) * 1000)
                if response.status_code in RETRYABLE and attempt < cfg.ai_max_retries:
                    attempt += 1
                    await asyncio.sleep(min(2 ** attempt, 20))
                    continue
                if response.status_code != 200:
                    raise _HTTPError(response.status_code, _error_type(response), latency)
                data = response.json()
                usage = data.get("usage") or {}
                record = dict(input_tokens=int(usage.get("input_tokens") or 0),
                              output_tokens=int(usage.get("output_tokens") or 0),
                              cache_read_tokens=int(usage.get("cache_read_input_tokens") or 0),
                              cache_write_tokens=int(usage.get("cache_creation_input_tokens") or 0),
                              cost_usd=call_cost(cfg, model, usage), latency_ms=latency)
                if data.get("stop_reason") == "max_tokens":
                    self.store.record_ai_call(day, agent, model, "OUTPUT_TOKEN_LIMIT",
                                              error="Response reached max_tokens; no AI decision accepted", **record)
                    self._failed("OUTPUT_TOKEN_LIMIT")
                    raise AIUnavailable("OUTPUT_TOKEN_LIMIT")
                text = "".join(block.get("text", "") for block in data.get("content", []) if block.get("type") == "text")
                try:
                    parsed = extract_json(text)
                except (ValueError, json.JSONDecodeError) as exc:
                    self.store.record_ai_call(day, agent, model, "BAD_OUTPUT",
                                              error=f"unparseable; stop={data.get('stop_reason')}", **record)
                    self._failed("BAD_OUTPUT")
                    raise AIUnavailable("BAD_OUTPUT") from exc
                self.store.record_ai_call(day, agent, model, "OK", **record)
                self.consecutive_failures, self.last_error, self.last_call_at = 0, None, time.time()
                self.authentication_failed = False
                return parsed
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                if attempt < cfg.ai_max_retries:
                    attempt += 1
                    await asyncio.sleep(min(2 ** attempt, 20))
                    continue
                reason = type(exc).__name__
                self.store.record_ai_call(day, agent, model, "ERROR", error=reason,
                                          latency_ms=int((time.monotonic() - started) * 1000))
                self._failed(reason)
                raise AIUnavailable(reason) from exc
            except _HTTPError as exc:
                detail = f"HTTP {exc.status}: {exc.kind}"
                reason = _public_http_error(exc.status)
                logger.warning("AUTONOMIQ PRO AI provider rejected request: %s", detail)
                self.store.record_ai_call(day, agent, model, reason, latency_ms=exc.latency, error=reason)
                self._failed(reason)
                if exc.status in (401, 403):
                    self.authentication_failed = True
                    self.circuit_open_until = time.time() + CIRCUIT_COOLDOWN_S
                raise AIUnavailable(reason) from exc

    def _failed(self, reason: str) -> None:
        self.consecutive_failures += 1
        self.last_error = reason
        logger.warning("AUTONOMIQ PRO AI call failed: %s", reason)
        if self.consecutive_failures >= CIRCUIT_THRESHOLD:
            self.circuit_open_until = time.time() + CIRCUIT_COOLDOWN_S


class _HTTPError(Exception):
    def __init__(self, status: int, kind: str, latency: int):
        super().__init__(status)
        self.status, self.kind, self.latency = status, kind, latency


def _error_type(response: httpx.Response) -> str:
    try:
        error = response.json().get("error") or {}
        kind = str(error.get("type") or "error")
        message = str(error.get("message") or "").strip()
        return f"{kind}: {message}"[:240] if message else kind
    except ValueError:
        return "error"


def _public_http_error(status: int) -> str:
    if status in (401, 403):
        return "AI_AUTHENTICATION_FAILED"
    if status == 429:
        return "AI_RATE_LIMITED"
    if 400 <= status < 500:
        return "AI_REQUEST_REJECTED"
    return "AI_SERVICE_UNAVAILABLE"

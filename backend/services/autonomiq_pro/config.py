"""AUTONOMIQ PRO configuration — read only from backend/.env (AUTONOMIQ_PRO_* keys)."""

from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from datetime import time
from pathlib import Path

from dotenv import dotenv_values

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"
PREFIX = "AUTONOMIQ_PRO_"
ANALYSIS_START = time(9, 0)
ANALYSIS_END = time(15, 20)
ANALYSIS_INTERVAL_MINUTES = 5
LIVE_EXECUTION_DISABLED_REASON = (
    "Live orders are disabled. Set LIVE_TRADE_ENABLED=true."
)

# USD per million tokens (input, output) — Anthropic published list prices.
MODEL_PRICES = {
    "claude-fable-5-2": (8.0, 40.0),
    "claude-opus-5-5": (4.0, 20.0),
    "claude-sonnet-5-5": (2.0, 10.0),
    "claude-haiku-5-5": (0.10, 0.50),
}
UNKNOWN_MODEL_PRICE = (8.0, 40.0)  # price unknown models conservatively


def _raw() -> dict[str, str]:
    file_values = dotenv_values(ENV_FILE)
    values = {k: v for k, v in file_values.items() if k.startswith(PREFIX) and v is not None}
    values.update({k: v for k, v in os.environ.items() if k.startswith(PREFIX)})
    global_live = os.getenv("LIVE_TRADE_ENABLED") or file_values.get("LIVE_TRADE_ENABLED")
    if global_live:
        values["LIVE_TRADE_ENABLED"] = global_live
    global_key = os.getenv("ANTHROPIC_API_KEY") or file_values.get("ANTHROPIC_API_KEY")
    global_enabled = os.getenv("AI_ENABLED") or file_values.get("AI_ENABLED")
    global_model = os.getenv("AI_MODEL") or file_values.get("AI_MODEL")
    global_daily = os.getenv("AI_DAILY_BUDGET_USD") or file_values.get("AI_DAILY_BUDGET_USD")
    global_monthly = os.getenv("AI_MONTHLY_BUDGET_USD") or file_values.get("AI_MONTHLY_BUDGET_USD")
    global_live = os.getenv("LIVE_TRADE_ENABLED") or file_values.get("LIVE_TRADE_ENABLED")
    if global_live:
        values["AUTONOMIQ_PRO_DEPLOYMENT_MODE"] = "production" if _bool(global_live, False) else "local"
        values["AUTONOMIQ_PRO_ALLOW_LOCAL_LIVE"] = "true" if _bool(global_live, False) else "false"
    return values


def global_live_trade_enabled() -> bool:
    env = dotenv_values(ENV_FILE)
    value = os.getenv("LIVE_TRADE_ENABLED") or env.get("LIVE_TRADE_ENABLED") or "false"
    return _bool(value, False)


def _bool(value: str | None, default: bool) -> bool:
    if value is None or value.strip() == "":
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


def _num(value: str | None, default: float, low: float, high: float) -> float:
    try:
        parsed = float(value) if value not in (None, "") else default
    except ValueError:
        parsed = default
    return min(max(parsed, low), high)


def _clock(value: str | None, default: time) -> time:
    try:
        hour, minute = (int(part) for part in (value or "").split(":"))
        return time(hour, minute)
    except (ValueError, TypeError):
        return default


@dataclass(frozen=True)
class AutonomiqConfig:
    enabled: bool = True
    ai_enabled: bool = False
    deployment_mode: str = "local"
    allow_local_live: bool = False
    live_execution_allowed: bool = False
    analysis_start: time = ANALYSIS_START
    analysis_interval_minutes: float = ANALYSIS_INTERVAL_MINUTES
    api_key: str = field(default="", repr=False)
    primary_model: str = "claude-fable-5-2"
    advanced_model: str = "claude-fable-5-2"
    quantum_model: str = "claude-haiku-5-5"
    quantum_max_output_tokens: int = 512
    quantum_ai_timeout_seconds: float = 15
    fable_event_only: bool = False
    reasoning_effort: str = "low"
    api_version: str = "2023-06-01"
    max_output_tokens: int = 500
    prompt_cache: bool = True
    monthly_budget_usd: float = 25.0
    daily_budget_usd: float = 1.25
    ai_timeout_seconds: float = 60
    ai_max_retries: int = 2
    require_ai_confirmation: bool = True
    auto_paper_trading: bool = False
    event_move_pct: float = 0.35
    market_start: time = time(9, 20)
    entry_cutoff: time = time(14, 45)
    square_off: time = time(15, 15)
    market_end: time = time(15, 25)
    extra_holidays: frozenset[str] = frozenset()
    max_data_age_seconds: float = 10
    max_option_quote_age_seconds: float = 60
    min_signal_score: float = 60
    min_risk_reward: float = 1.5
    max_spread_pct: float = 2.0
    max_entry_slippage_pct: float = 0.5
    max_exit_slippage_pct: float = 1.0
    estimated_round_trip_cost_rupees: float = 150
    max_open_positions: int = 3
    max_trades_per_day: int = 5
    daily_loss_limit_rupees: float = 3000
    max_risk_per_trade_rupees: float = 1000
    index_daily_loss_limit_rupees: float = 1000

    @property
    def ai_configured(self) -> bool:
        return bool(self.api_key) and bool(self.primary_model)

    def model_for(self, trigger: str) -> str:
        """Use the advanced model only for event analysis when event-only mode is enabled."""
        if trigger == "QUANTUM_SIGNAL":
            return self.quantum_model
        if self.fable_event_only and trigger == "EVENT":
            return self.advanced_model
        return self.primary_model

    @staticmethod
    def price(model: str) -> tuple[float, float]:
        return MODEL_PRICES.get(model, UNKNOWN_MODEL_PRICE)

    def public(self) -> dict:
        """Non-secret view for the dashboard. The API key is never included."""
        return {
            "enabled": self.enabled, "ai_enabled": self.ai_enabled, "ai_configured": self.ai_configured,
            "deployment_mode": self.deployment_mode,
            "allow_local_live": self.allow_local_live,
            "live_execution_allowed": self.live_execution_allowed,
            "analysis_interval_minutes": self.analysis_interval_minutes,
            "analysis_start": self.analysis_start.strftime("%H:%M"),
            "analysis_end": ANALYSIS_END.strftime("%H:%M"),
            "primary_model": self.primary_model, "advanced_model": self.advanced_model,
            "quantum_model": self.quantum_model,
            "quantum_max_output_tokens": self.quantum_max_output_tokens,
            "quantum_ai_timeout_seconds": self.quantum_ai_timeout_seconds,
            "fable_event_only": self.fable_event_only, "reasoning_effort": self.reasoning_effort,
            "event_move_pct": self.event_move_pct,
            "max_output_tokens": self.max_output_tokens, "prompt_cache": self.prompt_cache,
            "ai_timeout_seconds": self.ai_timeout_seconds, "ai_max_retries": self.ai_max_retries,
            "monthly_budget_usd": self.monthly_budget_usd, "daily_budget_usd": self.daily_budget_usd,
            "require_ai_confirmation": self.require_ai_confirmation,
            "market_start": self.market_start.strftime("%H:%M"), "entry_cutoff": self.entry_cutoff.strftime("%H:%M"),
            "square_off": self.square_off.strftime("%H:%M"), "market_end": self.market_end.strftime("%H:%M"),
            "min_signal_score": self.min_signal_score, "min_risk_reward": self.min_risk_reward,
            "max_data_age_seconds": self.max_data_age_seconds,
            "max_option_quote_age_seconds": self.max_option_quote_age_seconds,
            "max_spread_pct": self.max_spread_pct,
            "max_entry_slippage_pct": self.max_entry_slippage_pct,
            "max_exit_slippage_pct": self.max_exit_slippage_pct,
            "estimated_round_trip_cost_rupees": self.estimated_round_trip_cost_rupees,
            "max_open_positions": self.max_open_positions, "max_trades_per_day": self.max_trades_per_day,
            "daily_loss_limit_rupees": self.daily_loss_limit_rupees,
            "max_risk_per_trade_rupees": self.max_risk_per_trade_rupees,
            "index_daily_loss_limit_rupees": self.index_daily_loss_limit_rupees,
        }


def load_config() -> AutonomiqConfig:
    raw = _raw()
    file_values = dotenv_values(ENV_FILE)
    file_values = dotenv_values(ENV_FILE)

    def g(name: str, *aliases: str) -> str | None:
        for key in (name, *aliases):
            if PREFIX + key in raw:
                return raw[PREFIX + key]
        return None

    effort = (g("AI_REASONING_EFFORT") or "low").strip().lower()
    live_execution_allowed = global_live_trade_enabled()
    deployment_mode = "production" if live_execution_allowed else "local"
    allow_local_live = live_execution_allowed
    holidays = frozenset(day.strip() for day in (g("EXTRA_HOLIDAYS") or "").split(",") if day.strip())
    budget_error = "DAILY_LOSS_RUPEES must be finite and non-negative"
    try:
        index_daily_loss_limit = float(
            os.getenv("DAILY_LOSS_RUPEES")
            or file_values.get("DAILY_LOSS_RUPEES")
            or g("DAILY_LOSS_LIMIT_RUPEES")
            or g("INDEX_DAILY_LOSS_LIMIT_RUPEES")
            or "1000"
        )
    except ValueError as exc:
        raise ValueError(budget_error) from exc
    if not math.isfinite(index_daily_loss_limit) or index_daily_loss_limit < 0:
        raise ValueError(budget_error)
    file_values = dotenv_values(ENV_FILE)
    market_start = _clock(
        os.getenv("MARKET_START") or file_values.get("MARKET_START") or g("MARKET_START"),
        time(9, 20),
    )
    return AutonomiqConfig(
        enabled=_bool(g("ENABLED"), True),
        ai_enabled=_bool(
            os.getenv("AI_ENABLED") or file_values.get("AI_ENABLED") or g("AI_ENABLED"),
            False,
        ),
        deployment_mode=deployment_mode,
        allow_local_live=allow_local_live,
        live_execution_allowed=live_execution_allowed,
        analysis_start=market_start,
        analysis_interval_minutes=ANALYSIS_INTERVAL_MINUTES,
        api_key=(os.getenv("ANTHROPIC_API_KEY") or file_values.get("ANTHROPIC_API_KEY") or "").strip(),
        primary_model=(os.getenv("AI_MODEL") or file_values.get("AI_MODEL") or "claude-haiku-5-5").strip(),
        advanced_model=(os.getenv("AI_MODEL") or file_values.get("AI_MODEL") or "claude-haiku-5-5").strip(),
        quantum_model=(g("QUANTUM_MODEL") or "claude-haiku-5-5").strip(),
        quantum_max_output_tokens=int(_num(g("QUANTUM_MAX_OUTPUT_TOKENS"), 512, 100, 2000)),
        quantum_ai_timeout_seconds=_num(g("QUANTUM_AI_TIMEOUT_SECONDS"), 15, 5, 60),
        fable_event_only=_bool(g("FABLE_EVENT_ONLY"), False),
        reasoning_effort=effort if effort in ("low", "medium", "high", "xhigh", "max", "default") else "low",
        api_version=(g("AI_API_VERSION") or "2023-06-01").strip(),
        max_output_tokens=int(_num(g("MAX_OUTPUT_TOKENS"), 500, 200, 64000)),
        prompt_cache=_bool(g("PROMPT_CACHE"), True),
        monthly_budget_usd=_num(
            os.getenv("AI_MONTHLY_BUDGET_USD") or file_values.get("AI_MONTHLY_BUDGET_USD"),
            50, 0, 100_000,
        ),
        daily_budget_usd=_num(
            os.getenv("AI_DAILY_BUDGET_USD") or file_values.get("AI_DAILY_BUDGET_USD"),
            2.5, 0, 10_000,
        ),
        ai_timeout_seconds=_num(g("AI_TIMEOUT_SECONDS"), 60, 5, 600),
        ai_max_retries=int(_num(g("AI_MAX_RETRIES"), 2, 0, 5)),
        require_ai_confirmation=_bool(g("REQUIRE_AI_CONFIRMATION"), True),
        auto_paper_trading=False,
        event_move_pct=_num(g("EVENT_MOVE_PCT"), 0.35, 0.05, 5),
        market_start=market_start,
        entry_cutoff=_clock(
            os.getenv("ENTRY_CUTOFF") or file_values.get("ENTRY_CUTOFF") or g("ENTRY_CUTOFF"),
            time(14, 45),
        ),
        square_off=_clock(
            os.getenv("SQUARE_OFF") or file_values.get("SQUARE_OFF") or g("SQUARE_OFF"),
            time(15, 15),
        ),
        market_end=_clock(
            os.getenv("MARKET_END") or file_values.get("MARKET_END") or g("MARKET_END"),
            time(15, 25),
        ),
        extra_holidays=holidays,
        max_data_age_seconds=_num(g("MAX_DATA_AGE_SECONDS"), 10, 2, 120),
        max_option_quote_age_seconds=_num(g("MAX_OPTION_QUOTE_AGE_SECONDS"), 60, 5, 600),
        min_signal_score=_num(g("MIN_SIGNAL_SCORE"), 60, 10, 100),
        min_risk_reward=_num(g("MIN_RISK_REWARD"), 1.5, 0.5, 10),
        max_spread_pct=_num(g("MAX_SPREAD_PCT"), 2.0, 0.1, 20),
        max_entry_slippage_pct=_num(g("MAX_ENTRY_SLIPPAGE_PCT"), 0.5, 0.05, 2),
        max_exit_slippage_pct=_num(g("MAX_EXIT_SLIPPAGE_PCT"), 1.0, 0.1, 5),
        estimated_round_trip_cost_rupees=_num(g("ESTIMATED_ROUND_TRIP_COST_RUPEES"), 150, 0, 1000),
        max_open_positions=int(_num(
            os.getenv("OPEN_POSITIONS") or file_values.get("OPEN_POSITIONS") or g("MAX_OPEN_POSITIONS"),
            3, 1, 3,
        )),
        max_trades_per_day=int(_num(
            os.getenv("TRADES_PER_DAY") or file_values.get("TRADES_PER_DAY") or g("MAX_TRADES_PER_DAY"),
            5, 1, 50,
        )),
        daily_loss_limit_rupees=_num(
            os.getenv("DAILY_LOSS_RUPEES") or file_values.get("DAILY_LOSS_RUPEES") or g("DAILY_LOSS_LIMIT_RUPEES"),
            3000, 0, 10_000_000,
        ),
        max_risk_per_trade_rupees=_num(
            os.getenv("RISK_PER_TRADE_RUPEES") or file_values.get("RISK_PER_TRADE_RUPEES") or g("MAX_RISK_PER_TRADE_RUPEES"),
            1000, 0, 10_000_000,
        ),
        index_daily_loss_limit_rupees=index_daily_loss_limit,
    )

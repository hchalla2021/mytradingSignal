from __future__ import annotations

import os
from datetime import time
from pathlib import Path

from dotenv import dotenv_values
from pydantic import BaseModel, ConfigDict, Field, model_validator

ENV_FILE = Path(os.getenv("SMCAPEX_BACKEND_ENV_FILE",
                         str(Path(__file__).resolve().parents[1] / "backend" / ".env")))


def credentials() -> dict[str, str]:
    # Whitelist only credentials/config needed by this service. Never return to the UI.
    names = ("ZERODHA_API_KEY", "ZERODHA_ACCESS_TOKEN", "SMCAPEX_ANTHROPIC_API_KEY",
             "AUTONOMIQ_PRO_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "SMCAPEX_AI_MODEL",
             "SMCAPEX_SERVICE_TOKEN", "JWT_SECRET", "SMCAPEX_LIVE_ENABLED", "SMCAPEX_AI_MAX_CALLS_PER_DAY")
    if not ENV_FILE.is_file():
        raise ValueError("SMC Apex credential environment file is missing")
    values = dotenv_values(ENV_FILE)
    return {name: os.environ.get(name) or values.get(name) or "" for name in names}


class IndexRisk(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lots: int = Field(ge=1, le=100)
    risk_per_trade: float = Field(gt=0, le=1_000_000)
    daily_loss: float = Field(gt=0, le=1_000_000)
    stop_percent: float = Field(ge=5, le=40)
    max_spread_percent: float = Field(gt=0, le=2)
    entry_start: str = "09:25"
    entry_end: str = "14:45"

    @model_validator(mode="after")
    def validate_window(self):
        try:
            start, end = time.fromisoformat(self.entry_start), time.fromisoformat(self.entry_end)
        except ValueError as exc:
            raise ValueError("Entry hours must be HH:MM in IST") from exc
        if not time(9, 15) <= start < end <= time(15, 0):
            raise ValueError("Entry window must be within 09:15-15:00 IST")
        return self


class DailyRisk(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    daily_loss: float = Field(gt=0, le=3_000_000)


class TradeControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool

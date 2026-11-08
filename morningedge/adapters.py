from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol
from zoneinfo import ZoneInfo

from config import Settings
from pipeline import MarketPipeline


class EventStore(Protocol):
    async def append(self, event: dict[str, Any]) -> None: ...


class EventPublisher(Protocol):
    async def publish(self, channel: str, event: dict[str, Any]) -> None: ...


@dataclass(frozen=True)
class KiteAuthConfig:
    api_key: str
    access_token: str

    @classmethod
    def from_settings(cls, settings: Settings) -> "KiteAuthConfig":
        return cls(settings.api_key, settings.access_token)


class KiteTickerIngestion:
    """Callback adapter for the shared main-app Kite auth; intentionally no order API."""
    def __init__(self, pipeline: MarketPipeline, token_to_symbol: dict[int, str]) -> None:
        self.pipeline = pipeline
        self.token_to_symbol = dict(token_to_symbol)
        self.tz = ZoneInfo("Asia/Kolkata")

    def on_ticks(self, _ws: Any, ticks: list[dict[str, Any]]) -> None:
        for tick in ticks:
            symbol = self.token_to_symbol.get(tick.get("instrument_token"))
            stamp = tick.get("exchange_timestamp")
            price = tick.get("last_price")
            if symbol and isinstance(stamp, datetime) and isinstance(price, (float, int)):
                self.pipeline.ingest_real_tick(symbol, float(price), stamp)

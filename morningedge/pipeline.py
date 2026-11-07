from __future__ import annotations

import asyncio
import time
from collections import deque
from datetime import datetime, timedelta
from typing import Any

from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Kolkata")
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")


class MarketPipeline:
    """Bounded real-tick ingestion and per-index snapshot/features; no synthetic fallback."""
    def __init__(self, queue_capacity: int = 1024, freshness_seconds: int = 5) -> None:
        self.queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=queue_capacity)
        self.freshness_seconds = freshness_seconds
        self._snapshots: dict[str, dict[str, Any] | None] = {s: None for s in SYMBOLS}
        self._received = self._rejected = 0
        self._stage_ms: deque[float] = deque(maxlen=1000)
        self.model_is_validated = False

    def ingest_real_tick(self, symbol: str, price: float, timestamp: datetime) -> bool:
        now = datetime.now(TZ)
        if symbol not in SYMBOLS or price <= 0 or timestamp.tzinfo is None:
            self._rejected += 1
            return False
        stamped = timestamp.astimezone(TZ)
        if abs((now - stamped).total_seconds()) > self.freshness_seconds:
            self._rejected += 1
            return False
        item = {"symbol": symbol, "price": price, "timestamp": stamped.isoformat()}
        try:
            self.queue.put_nowait(item)
        except asyncio.QueueFull:
            self._rejected += 1
            return False
        started = time.perf_counter()
        self._received += 1
        self._snapshots[symbol] = item
        self._stage_ms.append((time.perf_counter() - started) * 1000)
        return True

    def has_fresh_real_data(self, now: datetime | None = None) -> bool:
        now = now or datetime.now(TZ)
        return all(s is not None and
                   abs((now - datetime.fromisoformat(s["timestamp"])).total_seconds()) <= self.freshness_seconds
                   for s in self._snapshots.values())

    def snapshots(self) -> dict[str, dict[str, Any] | None]:
        return {key: value.copy() if value else None for key, value in self._snapshots.items()}

    def metrics(self) -> dict[str, Any]:
        return {"received_ticks": self._received, "rejected_ticks": self._rejected,
                "queue_depth": self.queue.qsize(), "queue_capacity": self.queue.maxsize,
                "stage_latency_ms_mean": sum(self._stage_ms) / len(self._stage_ms) if self._stage_ms else None}


class EventBus:
    def __init__(self, capacity: int = 256) -> None:
        self.capacity = capacity
        self.subscribers: set[asyncio.Queue[dict[str, Any]]] = set()

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=self.capacity)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue: asyncio.Queue[dict[str, Any]]) -> None:
        self.subscribers.discard(queue)

    def publish(self, event: dict[str, Any]) -> None:
        for queue in tuple(self.subscribers):
            if queue.full():
                queue.get_nowait()
            queue.put_nowait(event)

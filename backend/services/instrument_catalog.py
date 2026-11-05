"""One daily instrument-master download per exchange, shared by existing broker consumers."""

import json
import logging
import threading
from datetime import date, datetime
from pathlib import Path

from services.aqte_engine import IST

logger = logging.getLogger(__name__)


class InstrumentCatalog:
    def __init__(self, directory=None):
        self.directory = Path(directory) if directory is not None else None
        self.lock = threading.RLock()
        self.refresh_locks = {exchange: threading.Lock() for exchange in ("NFO", "BFO")}
        self.rows = {}
        self.days = {}
        self.errors = {}

    def get(self, kite, exchange, now=None):
        if exchange not in ("NFO", "BFO"):
            raise ValueError("Unsupported derivatives exchange")
        today = (now or datetime.now(IST)).date().isoformat()
        with self.refresh_locks[exchange]:
            with self.lock:
                if self.days.get(exchange) == today:
                    return self.rows[exchange]
            path = self.directory / f"{exchange}.json" if self.directory else None
            rows = None
            if path and path.exists():
                try:
                    payload = json.loads(path.read_text(encoding="utf-8"))
                    if payload["day"] == today:
                        rows = payload["rows"]
                        self.validate(rows, exchange)
                        for row in rows:
                            if row.get("expiry"):
                                row["expiry"] = date.fromisoformat(row["expiry"])
                except (OSError, ValueError, KeyError, TypeError):
                    logger.exception("Instrument cache invalid for %s; refreshing from Kite", exchange)
                    rows = None
            try:
                if rows is None:
                    rows = kite.instruments(exchange)
                    self.validate(rows, exchange)
                    if path:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        temporary = path.with_suffix(".json.tmp")
                        temporary.write_text(json.dumps(dict(day=today, rows=rows), default=str), encoding="utf-8")
                        temporary.replace(path)
            except Exception as exc:
                with self.lock:
                    self.errors[exchange] = type(exc).__name__
                logger.exception("Instrument master unavailable for %s; yesterday's tokens are not substituted", exchange)
                raise
            with self.lock:
                self.rows[exchange], self.days[exchange] = rows, today
                self.errors.pop(exchange, None)
            return rows

    @staticmethod
    def validate(rows, exchange):
        if not isinstance(rows, list) or not rows or not all(
            isinstance(row, dict) and row.get("instrument_token") for row in rows
        ):
            raise ValueError(f"Empty or invalid {exchange} instrument master")

    def diagnostics(self):
        with self.lock:
            return {exchange: dict(day=self.days.get(exchange), instruments=len(self.rows.get(exchange, ())),
                                   error=self.errors.get(exchange)) for exchange in ("NFO", "BFO")}


instrument_catalog = InstrumentCatalog(Path(__file__).resolve().parent.parent / "data" / "instrument_catalog")

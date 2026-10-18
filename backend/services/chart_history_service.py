"""Paged, persistent cash-index history. Never substitutes futures OHLCV."""

import asyncio
import json
import logging
import math
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from pathlib import Path

import pytz
from kiteconnect import KiteConnect
from kiteconnect.exceptions import TokenException

from config import get_settings

logger = logging.getLogger(__name__)
IST = pytz.timezone("Asia/Kolkata")
TOKENS = {"NIFTY": 256265, "BANKNIFTY": 260105, "SENSEX": 265}
INTERVALS = {
    "3": "3minute", "5": "5minute", "15": "15minute", "30": "30minute", "60": "60minute",
    "D": "day", "W": "day", "M": "day",
}
_request_lock = threading.Lock()
_last_request = 0.0


def request_chart_candles(client, *args, **kwargs):
    """Share request pacing between chart snapshots and on-demand history."""
    global _last_request
    with _request_lock:
        wait = 0.4 - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
    return client.historical_data(*args, **kwargs)


class ChartHistoryUnavailable(Exception):
    pass


def normalize_candles(records):
    candles = {}
    for row in records:
        timestamp = row["date"]
        if isinstance(timestamp, str):
            timestamp = datetime.fromisoformat(timestamp)
        if timestamp.tzinfo is None:
            timestamp = IST.localize(timestamp)
        values = [float(row[key]) for key in ("open", "high", "low", "close")]
        volume = int(row.get("volume", 0))
        op, high, low, close = values
        if not all(math.isfinite(value) and value > 0 for value in values):
            raise ValueError("Historical provider returned invalid prices")
        if high < max(op, close) or low > min(op, close) or volume < 0:
            raise ValueError("Historical provider returned invalid OHLCV")
        epoch = int(timestamp.timestamp())
        candles[epoch] = {
            "t": timestamp.astimezone(IST).isoformat(),
            "o": op, "h": high, "l": low, "c": close, "v": volume,
        }
    return [candles[key] for key in sorted(candles)]


def period_start(day, interval):
    if interval == "W":
        return day - timedelta(days=day.weekday())
    if interval == "M":
        return day.replace(day=1)
    return day


def aggregate_daily_candles(candles, interval):
    if interval not in ("D", "W", "M"):
        return candles
    periods = {}
    for candle in candles:
        day = datetime.fromisoformat(candle["t"]).astimezone(IST).date()
        start = period_start(day, interval)
        key = IST.localize(datetime.combine(start, datetime.min.time())).isoformat()
        if key not in periods:
            periods[key] = {**candle, "t": key}
        else:
            bar = periods[key]
            bar["h"] = max(bar["h"], candle["h"])
            bar["l"] = min(bar["l"], candle["l"])
            bar["c"] = candle["c"]
            bar["v"] += candle["v"]
    return list(periods.values())


class ChartHistoryService:
    def __init__(self, db_path=None):
        self.db_path = db_path or Path(__file__).resolve().parent.parent / "data" / "chart_history.sqlite3"
        self._lock = asyncio.Lock()

    @contextmanager
    def _connect(self):
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(str(self.db_path), timeout=10)
        try:
            with connection:
                connection.execute(
                    "CREATE TABLE IF NOT EXISTS pages "
                    "(symbol TEXT, interval INTEGER, start TEXT, end TEXT, fetched REAL, payload TEXT, "
                    "PRIMARY KEY(symbol, interval, start, end))"
                )
                yield connection
        finally:
            connection.close()

    def _read(self, symbol, interval, start, end, mutable):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT fetched, payload FROM pages WHERE symbol=? AND interval=? AND start=? AND end=?",
                (symbol, interval, start, end),
            ).fetchone()
        finalized = row is not None and row[0] >= datetime.fromisoformat(end).timestamp()
        if row and (time.time() - row[0] < 20 if mutable else finalized):
            return json.loads(row[1])
        return None

    def _fetch(self, symbol, interval, start, end):
        interval = str(interval)
        settings = get_settings()
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            raise ChartHistoryUnavailable("Connect Zerodha to load uncached chart history.")
        client = KiteConnect(api_key=settings.zerodha_api_key, timeout=15)
        client.set_access_token(settings.zerodha_access_token)
        rows = request_chart_candles(
            client,
            TOKENS[symbol], datetime.fromisoformat(start), datetime.fromisoformat(end),
            INTERVALS[interval], continuous=False,
        )
        candles = aggregate_daily_candles(normalize_candles(rows), interval)
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                (symbol, interval, start, end, time.time(), json.dumps(candles)),
            )
        return candles

    async def page(self, symbol, interval, before=None, now=None):
        interval = str(interval)
        if symbol not in TOKENS or interval not in INTERVALS:
            raise ValueError("Unsupported chart symbol or interval")
        now = now or datetime.now(IST)
        if now.tzinfo is None:
            now = IST.localize(now)
        earliest = date(1970, 1, 1)
        end_date = before or now.date() + timedelta(days=1)
        if end_date > now.date() + timedelta(days=1) or end_date <= earliest:
            raise ValueError("History date must be after 1970-01-01 and not in the future")
        page_days = 365 if interval in ("D", "W", "M") else 14
        start_date = max(earliest, period_start(end_date - timedelta(days=page_days), interval))
        start = IST.localize(datetime.combine(start_date, datetime.min.time())).isoformat()
        end_dt = IST.localize(datetime.combine(end_date, datetime.min.time())) - timedelta(seconds=1)
        end = end_dt.isoformat()
        mutable = end_date > now.date()
        async with self._lock:
            try:
                candles = await asyncio.to_thread(self._read, symbol, interval, start, end, mutable)
                cached = candles is not None
                if candles is None:
                    candles = await asyncio.to_thread(self._fetch, symbol, interval, start, end)
                context_date = (
                    date(max(1970, start_date.year - 1), 1, 1) if interval in ("W", "M")
                    else max(earliest, start_date - timedelta(days=62))
                )
                context_start = IST.localize(datetime.combine(context_date, datetime.min.time())).isoformat()
                daily = await asyncio.to_thread(self._read, symbol, "D", context_start, end, mutable)
                if daily is None:
                    daily = await asyncio.to_thread(self._fetch, symbol, "D", context_start, end)
            except ChartHistoryUnavailable:
                raise
            except TokenException as error:
                logger.warning("Zerodha session rejected for chart history %s/%s", symbol, interval)
                raise ChartHistoryUnavailable(
                    "Zerodha session expired or invalid. Reconnect Zerodha to load history."
                ) from error
            except Exception as error:
                logger.exception("Chart history failed for %s/%s", symbol, interval)
                raise ChartHistoryUnavailable(
                    "Zerodha history is unavailable. Check your API session and data subscription, then retry."
                ) from error
        return {
            "candles": candles,
            "dailyCandles": daily,
            "nextBefore": start_date.isoformat() if start_date > earliest else None,
            "minimumQueryDate": earliest.isoformat(),
            "source": "ZERODHA_INDEX",
            "volumeSource": "INDEX_ONLY",
            "cached": cached,
        }


chart_history_service = ChartHistoryService()

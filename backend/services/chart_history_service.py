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
    "1": "minute", "3": "3minute", "5": "5minute", "15": "15minute", "30": "30minute", "60": "60minute",
    "D": "day", "W": "day", "M": "day",
}
_request_lock = threading.Lock()
_last_request = 0.0
_client_local = threading.local()


def kite_client(settings):
    """Reuse TLS connections without sharing a requests Session across worker threads."""
    key = (settings.zerodha_api_key, settings.zerodha_access_token)
    cached = getattr(_client_local, "client", None)
    if cached is None or cached[0] != key:
        client = KiteConnect(api_key=key[0], timeout=15)
        client.set_access_token(key[1])
        if cached is not None:
            cached[1].reqsession.close()
        _client_local.client = (key, client)
        return client
    return cached[1]


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
        # Open interest exists only for derivatives fetched with oi=True; it is never synthesized.
        oi = row.get("oi")
        if isinstance(oi, (int, float)) and math.isfinite(oi) and oi >= 0:
            candles[epoch]["oi"] = int(oi)
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
            if "oi" in candle:
                bar["oi"] = candle["oi"]
    return list(periods.values())


MARKET_OPEN = (9, 15)
# Small buffer after 15:30 so Zerodha has published the final candle before we treat the day as settled.
MARKET_SETTLED = (15, 32)


def next_market_open(moment):
    """Next 09:15 IST on a weekday strictly after `moment` (exchange holidays are not modelled)."""
    moment = moment.astimezone(IST)
    candidate = moment.replace(hour=MARKET_OPEN[0], minute=MARKET_OPEN[1], second=0, microsecond=0)
    if candidate <= moment:
        candidate += timedelta(days=1)
    while candidate.weekday() >= 5:
        candidate += timedelta(days=1)
    return candidate


def settled_snapshot(fetched, now):
    """A snapshot taken while the market is shut stays valid until the next session opens."""
    fetched = fetched.astimezone(IST)
    settled = fetched.replace(hour=MARKET_SETTLED[0], minute=MARKET_SETTLED[1], second=0, microsecond=0)
    opened = fetched.replace(hour=MARKET_OPEN[0], minute=MARKET_OPEN[1], second=0, microsecond=0)
    closed = fetched.weekday() >= 5 or fetched >= settled or fetched < opened
    return closed and now < next_market_open(fetched)


class ChartHistoryService:
    include_oi = False

    def __init__(self, db_path=None):
        self.db_path = db_path or Path(__file__).resolve().parent.parent / "data" / "chart_history.sqlite3"
        # One lock per page so different symbols/intervals load concurrently; identical requests still coalesce.
        self._locks = {}

    def _lock_for(self, key):
        lock = self._locks.get(key)
        if lock is None:
            lock = self._locks[key] = asyncio.Lock()
        return lock

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

    def _read(self, symbol, interval, start, end, mutable, now=None):
        with self._connect() as connection:
            row = connection.execute(
                "SELECT fetched, payload FROM pages WHERE symbol=? AND interval=? AND start=? AND end=?",
                (symbol, interval, start, end),
            ).fetchone()
        if row is None:
            return None
        if mutable:
            now = now or datetime.now(IST)
            fresh = now.timestamp() - row[0] < 20 or settled_snapshot(datetime.fromtimestamp(row[0], IST), now)
        else:
            fresh = row[0] >= datetime.fromisoformat(end).timestamp()
        return json.loads(row[1]) if fresh else None

    def _read_stored(self, symbol, interval, start, end):
        """Last stored copy of a page regardless of age (real Zerodha data, just older)."""
        with self._connect() as connection:
            row = connection.execute(
                "SELECT payload FROM pages WHERE symbol=? AND interval=? AND start=? AND end=?",
                (symbol, interval, start, end),
            ).fetchone()
        return json.loads(row[0]) if row else None

    retry_delay = 0.8

    def _fetch_resilient(self, symbol, interval, start, end):
        """Retry one transient Kite failure (429/timeout/network), then fall back to the stored page.

        Returns (candles, stale). Auth/configuration errors are never masked.
        """
        for attempt in range(2):
            try:
                return self._fetch(symbol, interval, start, end), False
            except (ChartHistoryUnavailable, TokenException):
                raise
            except Exception as error:
                if attempt == 0:
                    logger.warning("Chart history fetch failed for %s/%s (%s); retrying", symbol, interval, error)
                    time.sleep(self.retry_delay)
                    continue
                stored = self._read_stored(symbol, interval, start, end)
                if stored is None:
                    raise
                logger.warning("Serving stored chart history for %s/%s after Zerodha failure", symbol, interval)
                return stored, True

    def _fetch(self, symbol, interval, start, end):
        interval = str(interval)
        settings = get_settings()
        if not settings.zerodha_api_key or not settings.zerodha_access_token:
            raise ChartHistoryUnavailable("Connect Zerodha to load uncached chart history.")
        client = kite_client(settings)
        rows = request_chart_candles(
            client,
            self._instrument_token(symbol), datetime.fromisoformat(start), datetime.fromisoformat(end),
            INTERVALS[interval], continuous=False, **({"oi": True} if self.include_oi else {}),
        )
        candles = aggregate_daily_candles(normalize_candles(rows), interval)
        with self._connect() as connection:
            connection.execute(
                "INSERT OR REPLACE INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                (symbol, interval, start, end, time.time(), json.dumps(candles)),
            )
        return candles

    def _instrument_token(self, symbol):
        return TOKENS[symbol]

    async def page(self, symbol, interval, before=None, now=None):
        interval = str(interval)
        if symbol not in TOKENS or interval not in INTERVALS:
            raise ValueError("Unsupported chart symbol or interval")
        return await self._page(symbol, interval, before, now)

    async def _page(self, symbol, interval, before=None, now=None, include_daily=True):
        now = now or datetime.now(IST)
        if now.tzinfo is None:
            now = IST.localize(now)
        earliest = date(1970, 1, 1)
        end_date = before or now.date() + timedelta(days=1)
        if end_date > now.date() + timedelta(days=1) or end_date <= earliest:
            raise ValueError("History date must be after 1970-01-01 and not in the future")
        # 1m pages stay short: ~5 sessions is already ~1,900 bars.
        page_days = 365 if interval in ("D", "W", "M") else 5 if interval == "1" else 14
        start_date = max(earliest, period_start(end_date - timedelta(days=page_days), interval))
        start = IST.localize(datetime.combine(start_date, datetime.min.time())).isoformat()
        end_dt = IST.localize(datetime.combine(end_date, datetime.min.time())) - timedelta(seconds=1)
        end = end_dt.isoformat()
        mutable = end_date > now.date()
        async with self._lock_for((symbol, interval, start, end)):
            try:
                candles = await asyncio.to_thread(self._read, symbol, interval, start, end, mutable, now)
                cached = candles is not None
                stale = False
                if candles is None:
                    candles, stale = await asyncio.to_thread(self._fetch_resilient, symbol, interval, start, end)
                daily = []
                if include_daily:
                    context_date = (
                        date(max(1970, start_date.year - 1), 1, 1) if interval in ("W", "M")
                        else max(earliest, start_date - timedelta(days=62))
                    )
                    context_start = IST.localize(datetime.combine(context_date, datetime.min.time())).isoformat()
                    async with self._lock_for((symbol, "D", context_start, end)):
                        daily = await asyncio.to_thread(self._read, symbol, "D", context_start, end, mutable, now)
                        if daily is None:
                            daily, _ = await asyncio.to_thread(self._fetch_resilient, symbol, "D", context_start, end)
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
            "stale": stale,
        }


chart_history_service = ChartHistoryService()

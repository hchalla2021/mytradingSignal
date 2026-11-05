"""Append-only morning records, using local SQLite WAL by default or configured PostgreSQL."""

import asyncio
import contextlib
import json
import logging
import sqlite3
from datetime import datetime
from pathlib import Path

import asyncpg
from services.aqte_engine import IST, day

logger = logging.getLogger(__name__)


class MorningStore:
    def __init__(self, dsn: str = "", path=None):
        self.dsn = dsn
        self.path = Path(path or Path(__file__).resolve().parent.parent / "data" / "aqte" / "morning.sqlite3")
        self.pool = None
        self.ready = False
        self.backend = "postgresql" if dsn else "sqlite-wal"
        self.error = "Connecting to PostgreSQL" if dsn else "Connecting to local SQLite WAL"
        self.last_commit = None

    @property
    def configured(self):
        return bool(self.dsn) or self.path is not None

    async def connect(self):
        if self.dsn:
            if self.pool is None:
                self.pool = await asyncpg.create_pool(
                    self.dsn, min_size=1, max_size=2, timeout=5, command_timeout=5,
                    server_settings={"application_name": "aqte-morning"})
            await self.pool.execute("""
                CREATE TABLE IF NOT EXISTS aqte_morning_events (
                    id TEXT PRIMARY KEY, at DOUBLE PRECISION NOT NULL,
                    symbol TEXT, kind TEXT NOT NULL, payload JSONB NOT NULL
                );
                CREATE INDEX IF NOT EXISTS aqte_morning_events_time
                    ON aqte_morning_events(at, symbol);
            """)
        else:
            await asyncio.to_thread(self._sqlite_connect)
        self.ready = True
        self.error = None
        return True

    def _sqlite_connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with contextlib.closing(sqlite3.connect(str(self.path), timeout=5)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA synchronous=NORMAL")
            connection.execute("PRAGMA busy_timeout=5000")
            connection.execute("""
                CREATE TABLE IF NOT EXISTS aqte_morning_events (
                    id TEXT PRIMARY KEY, at REAL NOT NULL, symbol TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL
                )
            """)
            connection.execute("CREATE INDEX IF NOT EXISTS aqte_morning_events_time ON aqte_morning_events(at,symbol)")
            connection.commit()

    async def write(self, records):
        if not self.ready:
            raise RuntimeError("Morning market-data recorder is not connected")
        if not self.dsn:
            await asyncio.to_thread(self._sqlite_write, records)
            self.error = None
            self.last_commit = max((record["at"] for record in records), default=self.last_commit)
            return
        rows = [(record["id"], record["at"], record.get("symbol"), record["kind"],
                 json.dumps(record["payload"], allow_nan=False, default=self.json_value)) for record in records]
        # A retry after a lost COMMIT response must not duplicate records.
        async with self.pool.acquire() as connection, connection.transaction():
            await connection.executemany(
                "INSERT INTO aqte_morning_events(id,at,symbol,kind,payload) VALUES($1,$2,$3,$4,$5::jsonb) "
                "ON CONFLICT(id) DO NOTHING", rows)
        self.error = None
        self.last_commit = max((record["at"] for record in records), default=self.last_commit)

    def _sqlite_write(self, records):
        rows = [(record["id"], record["at"], record.get("symbol"), record["kind"],
                 json.dumps(record["payload"], allow_nan=False, default=self.json_value)) for record in records]
        with contextlib.closing(sqlite3.connect(str(self.path), timeout=5)) as connection, connection:
            connection.execute("PRAGMA busy_timeout=5000")
            connection.executemany(
                "INSERT INTO aqte_morning_events(id,at,symbol,kind,payload) VALUES(?,?,?,?,?) "
                "ON CONFLICT(id) DO NOTHING", rows)

    async def restore(self, now):
        if not self.ready:
            raise RuntimeError("Morning market-data recorder is not connected")
        if not self.dsn:
            return await asyncio.to_thread(self._sqlite_restore, now)
        midnight = datetime.fromtimestamp(now, IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        payload = await self.pool.fetchval(
            "SELECT payload FROM aqte_morning_events WHERE kind='PREOPEN_CONTEXT' AND at >= $1 AND at < $2 "
            "ORDER BY at DESC LIMIT 1", midnight, midnight + 86400)
        lost = await self.pool.fetchval("SELECT EXISTS(SELECT 1 FROM aqte_morning_events WHERE id=$1)",
                                       f"DATA_LOSS:{day(now)}")
        return dict(preopen=json.loads(payload) if payload else {}, lost=bool(lost))

    def _sqlite_restore(self, now):
        midnight = datetime.fromtimestamp(now, IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
        with contextlib.closing(sqlite3.connect(str(self.path), timeout=5)) as connection:
            row = connection.execute(
                "SELECT payload FROM aqte_morning_events WHERE kind='PREOPEN_CONTEXT' AND at>=? AND at<? "
                "ORDER BY at DESC LIMIT 1", (midnight, midnight + 86400)).fetchone()
            lost = connection.execute("SELECT EXISTS(SELECT 1 FROM aqte_morning_events WHERE id=?)",
                                      (f"DATA_LOSS:{day(now)}",)).fetchone()[0]
        return dict(preopen=json.loads(row[0]) if row else {}, lost=bool(lost))

    @staticmethod
    def json_value(value):
        if isinstance(value, datetime):
            return value.isoformat()
        raise TypeError(f"Unsupported morning journal value: {type(value).__name__}")

    async def close(self):
        if self.pool is not None:
            try:
                await asyncio.wait_for(self.pool.close(), 5)
            except TimeoutError:
                logger.error("Morning PostgreSQL shutdown timed out")
                self.pool.terminate()
            self.pool = None
        self.ready = False


STORE_ERRORS = (asyncpg.PostgresError, asyncpg.InterfaceError, sqlite3.Error, OSError, TimeoutError, ValueError)

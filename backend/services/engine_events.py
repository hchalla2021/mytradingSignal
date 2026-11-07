"""Durable AQTE activity events with replayable WebSocket subscribers."""

import asyncio
from contextlib import closing
import logging
import sqlite3
import time
from pathlib import Path
from uuid import uuid4

import asyncpg

logger = logging.getLogger(__name__)
SEVERITIES = {"info", "success", "warning", "error"}


class EngineEventStore:
    def __init__(self, dsn="", path=None):
        self.dsn = dsn
        self.path = Path(path or Path(__file__).resolve().parent.parent / "data" / "aqte" / "live_events.sqlite3")
        self.pool = None
        self.backend = "sqlite-wal"

    async def connect(self):
        if self.dsn:
            try:
                self.pool = await asyncpg.create_pool(
                    self.dsn, min_size=1, max_size=2, timeout=5, command_timeout=5,
                    server_settings={"application_name": "aqte-live-events"},
                )
                await self.pool.execute("""
                    CREATE TABLE IF NOT EXISTS aqte_live_engine_events (
                        id BIGSERIAL PRIMARY KEY,
                        at DOUBLE PRECISION NOT NULL,
                        instrument TEXT,
                        event_type TEXT NOT NULL,
                        severity TEXT NOT NULL,
                        message TEXT NOT NULL,
                        source TEXT NOT NULL,
                        idempotency_key TEXT NOT NULL UNIQUE
                    )
                """)
                await self.pool.execute(
                    "CREATE INDEX IF NOT EXISTS aqte_live_engine_events_time "
                    "ON aqte_live_engine_events(at, instrument)"
                )
                self.backend = "postgresql"
                return
            except (asyncpg.PostgresError, asyncpg.InterfaceError, OSError, TimeoutError, ValueError):
                logger.exception("AQTE event PostgreSQL unavailable; using the local SQLite event journal")
                if self.pool is not None:
                    self.pool.terminate()
                    self.pool = None
                self.backend = "sqlite-wal-fallback"
        await asyncio.to_thread(self._sqlite_connect)

    def _sqlite_connect(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(str(self.path), timeout=5)) as db, db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("PRAGMA synchronous=NORMAL")
            db.execute("PRAGMA busy_timeout=5000")
            db.execute("""
                CREATE TABLE IF NOT EXISTS aqte_live_engine_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    at REAL NOT NULL,
                    instrument TEXT,
                    event_type TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    source TEXT NOT NULL,
                    idempotency_key TEXT NOT NULL UNIQUE
                )
            """)
            db.execute(
                "CREATE INDEX IF NOT EXISTS aqte_live_engine_events_time "
                "ON aqte_live_engine_events(at, instrument)"
            )

    async def append(self, event):
        if self.pool is not None:
            row = await self.pool.fetchrow(
                "INSERT INTO aqte_live_engine_events "
                "(at,instrument,event_type,severity,message,source,idempotency_key) "
                "VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(idempotency_key) DO NOTHING "
                "RETURNING id,at,instrument,event_type,severity,message,source",
                event["at"], event["instrument"], event["event_type"], event["severity"],
                event["message"], event["source"], event["idempotency_key"],
            )
            return self._event(row) if row else None
        return await asyncio.to_thread(self._sqlite_append, event)

    def _sqlite_append(self, event):
        with closing(sqlite3.connect(str(self.path), timeout=5)) as db, db:
            db.execute("PRAGMA busy_timeout=5000")
            cursor = db.execute(
                "INSERT INTO aqte_live_engine_events "
                "(at,instrument,event_type,severity,message,source,idempotency_key) "
                "VALUES(?,?,?,?,?,?,?) ON CONFLICT(idempotency_key) DO NOTHING",
                (event["at"], event["instrument"], event["event_type"], event["severity"],
                 event["message"], event["source"], event["idempotency_key"]),
            )
            if cursor.rowcount == 0:
                return None
            row = db.execute(
                "SELECT id,at,instrument,event_type,severity,message,source "
                "FROM aqte_live_engine_events WHERE id=?",
                (cursor.lastrowid,),
            ).fetchone()
        return self._event(row)

    async def read_after(self, event_id, limit=200):
        limit = min(max(int(limit), 1), 500)
        if self.pool is not None:
            if event_id > 0:
                rows = await self.pool.fetch(
                    "SELECT id,at,instrument,event_type,severity,message,source "
                    "FROM aqte_live_engine_events WHERE id>$1 ORDER BY id LIMIT $2", event_id, limit,
                )
            else:
                rows = await self.pool.fetch(
                    "SELECT id,at,instrument,event_type,severity,message,source "
                    "FROM (SELECT id,at,instrument,event_type,severity,message,source "
                    "FROM aqte_live_engine_events ORDER BY id DESC LIMIT $1) recent ORDER BY id", limit,
                )
            return [self._event(row) for row in rows]
        return await asyncio.to_thread(self._sqlite_read_after, event_id, limit)

    def _sqlite_read_after(self, event_id, limit):
        with closing(sqlite3.connect(str(self.path), timeout=5)) as db:
            if event_id > 0:
                rows = db.execute(
                    "SELECT id,at,instrument,event_type,severity,message,source "
                    "FROM aqte_live_engine_events WHERE id>? ORDER BY id LIMIT ?", (event_id, limit),
                ).fetchall()
            else:
                rows = db.execute(
                    "SELECT id,at,instrument,event_type,severity,message,source FROM "
                    "(SELECT id,at,instrument,event_type,severity,message,source "
                    "FROM aqte_live_engine_events ORDER BY id DESC LIMIT ?) ORDER BY id", (limit,),
                ).fetchall()
        return [self._event(row) for row in rows]

    @staticmethod
    def _event(row):
        return dict(id=int(row["id"] if hasattr(row, "keys") else row[0]),
                    at=float(row["at"] if hasattr(row, "keys") else row[1]),
                    instrument=row["instrument"] if hasattr(row, "keys") else row[2],
                    event_type=row["event_type"] if hasattr(row, "keys") else row[3],
                    severity=row["severity"] if hasattr(row, "keys") else row[4],
                    message=row["message"] if hasattr(row, "keys") else row[5],
                    source=row["source"] if hasattr(row, "keys") else row[6])

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None


class EngineEventService:
    def __init__(self, store):
        self.store = store
        self.loop = None
        self.ready = False
        self.subscribers = set()
        self.tasks = set()
        self.publish_lock = asyncio.Lock()

    async def start(self):
        if self.ready:
            return
        await self.store.connect()
        self.loop = asyncio.get_running_loop()
        self.ready = True
        logger.info("AQTE live event journal ready (%s)", self.store.backend)

    async def publish(self, event_type, message, *, instrument=None, severity="info", source="aqte",
                      idempotency_key=None):
        if not self.ready:
            return None
        if severity not in SEVERITIES:
            raise ValueError(f"Unsupported event severity: {severity}")
        event = dict(
            at=time.time(), instrument=str(instrument)[:64] if instrument else None,
            event_type=str(event_type)[:80], severity=severity,
            message=" ".join(str(message).split())[:500], source=str(source)[:64],
            idempotency_key=str(idempotency_key or uuid4().hex)[:200],
        )
        async with self.publish_lock:
            try:
                saved = await self.store.append(event)
            except (asyncpg.PostgresError, asyncpg.InterfaceError, sqlite3.Error, OSError, TimeoutError, ValueError):
                logger.exception("AQTE event journal write failed; event was not broadcast")
                return None
            if saved is not None:
                for queue in tuple(self.subscribers):
                    try:
                        queue.put_nowait(saved)
                    except asyncio.QueueFull:
                        while not queue.empty():
                            queue.get_nowait()
                        queue.put_nowait(None)
            return saved

    def publish_threadsafe(self, event_type, message, **kwargs):
        loop = self.loop
        if not self.ready or loop is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(self._schedule_publish, event_type, message, kwargs)
        except RuntimeError:
            logger.warning("AQTE event omitted because the application event loop is stopping")

    def _schedule_publish(self, event_type, message, kwargs):
        if not self.ready:
            return
        task = asyncio.create_task(self.publish(event_type, message, **kwargs))
        self.tasks.add(task)
        task.add_done_callback(self._publish_done)

    def _publish_done(self, task):
        self.tasks.discard(task)
        if not task.cancelled():
            error = task.exception()
            if error is not None:
                logger.error("AQTE event publishing task failed",
                             exc_info=(type(error), error, error.__traceback__))

    async def history(self, event_id=0, limit=200):
        return await self.store.read_after(event_id, limit)

    def subscribe(self, capacity=256):
        queue = asyncio.Queue(maxsize=capacity)
        self.subscribers.add(queue)
        return queue

    def unsubscribe(self, queue):
        self.subscribers.discard(queue)

    async def stop(self):
        self.ready = False
        if self.tasks:
            await asyncio.gather(*tuple(self.tasks), return_exceptions=True)
        self.loop = None
        await self.store.close()


_service = None


def get_engine_event_service():
    global _service
    if _service is None:
        from config import get_settings

        _service = EngineEventService(EngineEventStore(get_settings().aqte_morning_postgres_url))
    return _service

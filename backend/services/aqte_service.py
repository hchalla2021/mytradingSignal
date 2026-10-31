"""AQTE feed adapter and isolated WAL journal; never submits broker orders."""

import asyncio
import copy
import json
import logging
import math
import os
import queue
import sqlite3
import threading
import time
from dataclasses import asdict
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from services.aqte_engine import AQTEEngine, Contract, IST, SYMBOLS, Tick, day

logger = logging.getLogger(__name__)


def exchange_time(raw, received, kind):
    value = raw.get("exchange_timestamp")
    if value is None:
        # Kite index packets do not contain exchange timestamps.
        if kind == "spot":
            return received
        raise ValueError("Derivative tick missing exchange timestamp")
    if isinstance(value, datetime):
        return (value.replace(tzinfo=IST) if value.tzinfo is None else value).timestamp()
    raise ValueError("Invalid exchange timestamp")


def normalize(symbol, kind, raw, received):
    depth = raw.get("depth") or {}
    buys, sells = depth.get("buy", []), depth.get("sell", [])
    bid = buys[0] if buys else {}
    ask = sells[0] if sells else {}
    return Tick(symbol=symbol, kind=kind, token=int(raw["instrument_token"]),
                price=float(raw["last_price"]), at=exchange_time(raw, received, kind),
                received=received, volume=int(raw.get("volume_traded") or 0),
                bid=float(bid.get("price") or 0), ask=float(ask.get("price") or 0),
                bid_quantity=int(bid.get("quantity") or 0), ask_quantity=int(ask.get("quantity") or 0),
                buy_depth=sum(int(level.get("quantity") or 0) for level in buys),
                sell_depth=sum(int(level.get("quantity") or 0) for level in sells))


class AQTEService:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("AQTE_DB_PATH") or
                         Path(__file__).resolve().parent.parent / "data" / "aqte" / "aqte.sqlite3")
        self.engine = AQTEEngine()
        self.lock = threading.RLock()
        self.queue = queue.Queue(maxsize=20_000)
        self.stop_event = threading.Event()
        self.worker = None
        self.refresh_task = None
        self.kite = self.socket = None
        self.connection = None
        self.catalog = []
        self.catalog_day = None
        self.subscribed = set()
        self.subscription_error = None
        self.started = False
        self.failed = threading.Event()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(str(self.path), timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS aqte_state (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aqte_events (
                    id TEXT PRIMARY KEY, at REAL NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aqte_trades (
                    id TEXT PRIMARY KEY, exit_at REAL NOT NULL, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aqte_contracts (
                    token INTEGER PRIMARY KEY, payload TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS aqte_ticks (
                    id INTEGER PRIMARY KEY, at REAL NOT NULL, received REAL NOT NULL,
                    symbol TEXT NOT NULL, kind TEXT NOT NULL, token INTEGER NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS aqte_tick_time ON aqte_ticks(at);
                CREATE INDEX IF NOT EXISTS aqte_tick_received ON aqte_ticks(received);
                CREATE INDEX IF NOT EXISTS aqte_future_recovery ON aqte_ticks(kind,received);
                CREATE INDEX IF NOT EXISTS aqte_event_time ON aqte_events(at);
            """)
            state = db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()
            if state:
                payload = json.loads(state["payload"])
                self.engine.orders = payload["orders"]
                self.engine.killed = payload["killed"]
                self.engine.last_setup = payload["last_setup"]
                for setup in self.engine.last_setup.values():
                    setup["key"] = tuple(setup["key"])
                for order in self.engine.orders.values():
                    contract = Contract(**order["contract"])
                    self.engine.contracts[contract.token] = contract
            self.engine.trades = [json.loads(r["payload"]) for r in db.execute(
                "SELECT payload FROM aqte_trades ORDER BY exit_at, rowid")]
            midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            for row in db.execute("SELECT payload FROM aqte_ticks WHERE kind='future' AND received>=? "
                                  "ORDER BY received,id", (midnight,)):
                tick = Tick(**json.loads(row["payload"]))
                if self.engine.fresh(tick, tick.received):
                    self.engine.book.add(tick)
            # Only raw ticks expire. Audit and completed paper trades are retained.
            db.execute("DELETE FROM aqte_ticks WHERE received < ?", (time.time() - 7 * 86400,))

    def persist(self, db, ticks=()):
        db.executemany("INSERT INTO aqte_ticks(at,received,symbol,kind,token,payload) VALUES(?,?,?,?,?,?)",
                       [(t.at, t.received, t.symbol, t.kind, t.token, json.dumps(asdict(t))) for t in ticks])
        db.executemany("INSERT INTO aqte_contracts VALUES(?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload",
                       [(token, json.dumps(asdict(contract))) for token, contract in self.engine.contracts.items()])
        for event in self.engine.events:
            db.execute("INSERT INTO aqte_events VALUES(?,?,?,?)",
                       (event["id"], event["at"], event["kind"], json.dumps(event)))
            if event["kind"] == "CLOSED":
                trade = event["trade"]
                db.execute("INSERT INTO aqte_trades VALUES(?,?,?)",
                           (trade["id"], trade["exit_at"], json.dumps(trade)))
        state = dict(orders=self.engine.orders, killed=self.engine.killed, last_setup=self.engine.last_setup)
        db.execute("INSERT INTO aqte_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                   (json.dumps(state),))

    def run(self):
        try:
            with self.connect() as db:
                while not self.stop_event.is_set() or not self.queue.empty():
                    batch = []
                    try:
                        batch.append(self.queue.get(timeout=0.25))
                    except queue.Empty:
                        pass
                    while len(batch) < 500:
                        try:
                            batch.append(self.queue.get_nowait())
                        except queue.Empty:
                            break
                    with self.lock:
                        if self.failed.is_set():
                            self.engine.fault = "AQTE recording/queue fault; restart required"
                        for tick in batch:
                            if self.engine.fresh(tick, time.time()):
                                self.engine.ingest(tick)
                            else:
                                self.engine.event("PROCESSING_STALE_TICK", time.time(),
                                                  token=tick.token, reason="Queued quote too old for execution")
                        self.engine.manage(time.time())
                        with db:
                            self.persist(db, batch)
                        self.engine.events.clear()
        except Exception:
            self.failed.set()
            logger.exception("AQTE worker stopped; paper execution is blocked")
            with self.lock:
                self.engine.fault = "AQTE journal/processing failure; restart required"

    async def start(self):
        if self.started:
            return
        await asyncio.to_thread(self.initialize)
        self.stop_event.clear()
        self.started = True
        self.worker = threading.Thread(target=self.run, name="aqte-paper", daemon=True)
        self.worker.start()
        self.refresh_task = asyncio.create_task(self.refresh(), name="aqte-subscriptions")

    async def stop(self):
        if self.refresh_task:
            self.refresh_task.cancel()
            try:
                await self.refresh_task
            except asyncio.CancelledError:
                pass
        self.stop_event.set()
        if self.worker:
            await asyncio.to_thread(self.worker.join)
        self.started = False

    def enqueue(self, symbol, kind, raw):
        if not self.started:
            return
        try:
            tick = normalize(symbol, kind, raw, time.time())
            self.queue.put_nowait(tick)
        except queue.Full:
            if not self.failed.is_set():
                logger.error("AQTE tick queue full; new entries blocked until restart")
            self.failed.set()
        except (ValueError, TypeError, KeyError, OverflowError):
            logger.exception("AQTE rejected malformed %s tick for %s", kind, symbol)
            self.failed.set()

    def option_tick(self, raw):
        # Contract maps are replaced atomically, never mutated by the worker.
        # Do not let journal I/O block the shared KiteTicker callback.
        contract = self.engine.contracts.get(raw.get("instrument_token"))
        if contract:
            self.enqueue(contract.symbol, "option", raw)
            return True
        return False

    def configure(self, kite, socket, prices=None, previous_day=None):
        """Called on the existing Kite connection and each minute for ATM rotation."""
        if not self.started:
            return
        self.kite, self.socket = kite, socket
        try:
            today = day(time.time())
            if self.catalog_day != today:
                catalog = kite.instruments("NFO") + kite.instruments("BFO")
                self.catalog = [i for i in catalog if i.get("name") in SYMBOLS and
                                i.get("instrument_type") in ("CE", "PE")]
                self.catalog_day = today
            with self.lock:
                spots = {s: t.price for s, t in self.engine.spot.items()}
                pinned = {o["token"] for o in self.engine.orders.values()}
                selected = {t: c for t, c in self.engine.contracts.items() if t in pinned}
            from services.aqte_live import get_live_service
            selected.update(get_live_service().pins())
            for symbol in SYMBOLS:
                price = spots.get(symbol) or (prices or {}).get(symbol)
                if not price:
                    continue
                available = [i for i in self.catalog if i["name"] == symbol and
                             str(i["expiry"])[:10] >= today]
                if not available:
                    continue
                expiry = min(str(i["expiry"])[:10] for i in available)
                available = [i for i in available if str(i["expiry"])[:10] == expiry]
                strikes = sorted({float(i["strike"]) for i in available}, key=lambda k: abs(k - price))[:3]
                for i in available:
                    if float(i["strike"]) not in strikes:
                        continue
                    lot, size = int(i["lot_size"]), float(i["tick_size"])
                    if lot <= 0 or not math.isfinite(size) or size <= 0:
                        raise ValueError("Broker instrument has invalid lot/tick size")
                    token = int(i["instrument_token"])
                    selected[token] = Contract(symbol, token, i["tradingsymbol"], i["exchange"],
                                               i["instrument_type"], float(i["strike"]), expiry, lot, size)
            with self.lock:
                # The live pilot owns subscriptions for its broker-held contract too.
                # Live pins were copied without holding the market lock.
                # Orders may have been created while the broker catalog was fetched.
                for order in self.engine.orders.values():
                    token = order["token"]
                    selected[token] = self.engine.contracts[token]
                # Register before subscribe: initial option packets can arrive immediately.
                self.engine.contracts = selected
            tokens = set(selected)
            if tokens:
                # Re-subscribe all on reconnect, not just newly selected tokens.
                socket.subscribe(sorted(tokens))
                socket.set_mode(socket.MODE_FULL, sorted(tokens))
            removed = self.subscribed - tokens
            if removed:
                socket.unsubscribe(sorted(removed))
            with self.lock:
                if previous_day:
                    self.engine.previous_day = copy.deepcopy(previous_day)
                self.subscribed = tokens
                self.subscription_error = None
        except Exception as exc:
            # Broker boundary: retain old subscriptions and never invent contracts.
            logger.exception("AQTE option subscriptions unavailable")
            with self.lock:
                self.subscription_error = f"Option subscription failed ({type(exc).__name__})"

    def attach(self, kite, socket, prices, previous_day):
        self.connection = (kite, socket, copy.deepcopy(prices), copy.deepcopy(previous_day))

    async def refresh(self):
        active = None
        refreshed = 0
        while True:
            await asyncio.sleep(1)
            connection = self.connection
            if connection is not None and (connection is not active or time.monotonic() - refreshed >= 60):
                kite, socket, prices, previous_day = connection
                if socket.is_connected():
                    await asyncio.to_thread(self.configure, kite, socket, prices, previous_day)
                    active, refreshed = connection, time.monotonic()

    def snapshot(self):
        with self.lock:
            result = copy.deepcopy(self.engine.snapshot(time.time()))
            result["subscription_error"] = self.subscription_error
            result["recording"] = self.started and not self.failed.is_set()
            if self.failed.is_set() or not self.started:
                for signal in result["data"].values():
                    signal.update(decision="WAIT", entry=None, reasons=["AQTE recorder unavailable"])
            return result

    def history(self, limit):
        with self.connect() as db:
            return {
                "trades": [json.loads(r["payload"]) for r in db.execute(
                    "SELECT payload FROM aqte_trades ORDER BY exit_at DESC LIMIT ?", (limit,))],
                "events": [json.loads(r["payload"]) for r in db.execute(
                    "SELECT payload FROM aqte_events ORDER BY at DESC LIMIT ?", (limit,))],
            }

    def kill(self):
        with self.lock:
            self.engine.killed = True
            self.engine.event("KILL_SWITCH", time.time(), reason="Authenticated emergency stop")
            self.engine.manage(time.time())
            try:
                with self.connect() as db:
                    self.persist(db)
                self.engine.events.clear()
            except sqlite3.Error:
                self.failed.set()
                logger.exception("AQTE emergency stop journal failed; stop remains latched")
                raise
        return self.snapshot()


_service = None


def get_aqte_service():
    global _service
    if _service is None:
        _service = AQTEService()
    return _service

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
from collections import deque
from dataclasses import asdict
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path

from services.aqte_engine import (
    AQTEEngine, CLOSE_MINUTE, Contract, IST, OPEN_MINUTE, SESSION_CANDLES, SYMBOLS, WARMUP_CANDLES, Policy, Tick, day,
    live_intelligence, minute_of_day, opportunity_key, parse_scalp_points, session, session_bars, validate_tick, warmup_count,
)
from services.aqte_engines import (
    ENGINES, ML_MAX_AGE_SECONDS, EngineConfig, engine_card, evaluate, orchestrate, prepare_evaluation, session_change,
)
from services.aqte_features import FeatureCache
from services.aqte_ml import FEATURE_NAMES, SCHEMA, MLUnavailable, ShadowModel, feature_vector
from services.aqte_runtime import EngineWorkers, Latencies
from services.instrument_catalog import InstrumentCatalog, instrument_catalog

logger = logging.getLogger(__name__)
VIX_INSTRUMENT = "NSE:INDIA VIX"
VIX_STALE_SECONDS = 15


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
    tick = Tick(symbol=symbol, kind=kind, token=int(raw["instrument_token"]),
                price=float(raw["last_price"]), at=exchange_time(raw, received, kind),
                received=received, volume=int(raw.get("volume_traded") or 0),
                bid=float(bid.get("price") or 0), ask=float(ask.get("price") or 0),
                bid_quantity=int(bid.get("quantity") or 0), ask_quantity=int(ask.get("quantity") or 0),
                buy_depth=sum(int(level.get("quantity") or 0) for level in buys),
                sell_depth=sum(int(level.get("quantity") or 0) for level in sells), oi=raw.get("oi"))
    validate_tick(tick)
    return tick


class AQTEService:
    def __init__(self, path=None, *, paper_enabled=False, ml_model_path="", policy=None, engine_config=None):
        self.path = Path(path or os.getenv("AQTE_DB_PATH") or
                         Path(__file__).resolve().parent.parent / "data" / "aqte" / "aqte.sqlite3")
        self.metrics = Latencies()
        self.features = FeatureCache(self.metrics)
        self.engine = AQTEEngine(policy, paper_enabled=paper_enabled, feature_cache=self.features)
        self.evaluators = None
        self.contexts = {}
        self.signal_states = {}
        self.signal_events = deque(maxlen=100)
        self.listener = None
        self.morning = None
        self.instrument_catalog = InstrumentCatalog() if path is not None else instrument_catalog
        self.persisted_contracts = {}
        self.health_lock = threading.RLock()
        self.gaps = {}
        self.last_tick_at = None
        self.last_received_at = None
        self.history_errors = {}
        self.history_retry = {}
        self.prepared_at = None
        self.feed_connected = None
        self.connection_at = None
        self.engine_config = engine_config or EngineConfig()
        self.engine_states = {}
        self.engine_events = deque(maxlen=40)
        self.engine_error = None
        self.vix = None
        self.vix_token = None
        self.vix_day = None
        self.backfill_after = 0.0
        self.lock = threading.RLock()
        self.queue = queue.Queue(maxsize=20_000)
        self.stop_event = threading.Event()
        self.worker = None
        self.refresh_task = None
        self.kite = self.socket = None
        self.connection = None
        self.catalog = []
        self.catalog_day = None
        self.catalog_errors = {}
        self.configured_days = {}
        self.subscribed = set()
        self.subscription_error = None
        self.started = False
        self.failed = threading.Event()
        self.ml_model_path = Path(ml_model_path) if ml_model_path else None
        self.ml_model = None
        self.ml_task = None
        self.ml_seen = {}
        self.ml_candidates = {}
        self.ml_state = dict(status="DISABLED", mode="SHADOW_ONLY", affects_orders=False,
                             validated=False, error=None, observations={})

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
                CREATE TABLE IF NOT EXISTS aqte_contract_history (
                    session_day TEXT NOT NULL, token INTEGER NOT NULL, payload TEXT NOT NULL,
                    PRIMARY KEY(session_day,token));
                CREATE TABLE IF NOT EXISTS aqte_ticks (
                    id INTEGER PRIMARY KEY, at REAL NOT NULL, received REAL NOT NULL,
                    symbol TEXT NOT NULL, kind TEXT NOT NULL, token INTEGER NOT NULL, payload TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS aqte_tick_time ON aqte_ticks(at);
                CREATE INDEX IF NOT EXISTS aqte_tick_received ON aqte_ticks(received);
                CREATE INDEX IF NOT EXISTS aqte_future_recovery ON aqte_ticks(kind,received);
                CREATE INDEX IF NOT EXISTS aqte_event_time ON aqte_events(at);
            """)
            state = db.execute("SELECT payload FROM aqte_state WHERE id=1").fetchone()
            if state and self.engine.paper_enabled:
                payload = json.loads(state["payload"])
                self.engine.orders = payload["orders"]
                self.engine.killed = payload["killed"]
                self.engine.last_setup = payload["last_setup"]
                for setup in self.engine.last_setup.values():
                    setup["key"] = tuple(setup["key"])
                for order in self.engine.orders.values():
                    contract = Contract(**order["contract"])
                    self.engine.contracts[contract.token] = contract
            if self.engine.paper_enabled:
                self.engine.trades = [json.loads(r["payload"]) for r in db.execute(
                    "SELECT payload FROM aqte_trades ORDER BY exit_at, rowid")]
            midnight = datetime.now(IST).replace(hour=0, minute=0, second=0, microsecond=0).timestamp()
            # Indicators continue from the previous session: replay only its last ~4 hours of futures ticks.
            last = db.execute("SELECT MAX(received) FROM aqte_ticks WHERE kind='future' AND received<?",
                              (midnight,)).fetchone()[0]
            start = min(midnight, last - (WARMUP_CANDLES + 60) * 60) if last else midnight
            for row in db.execute("SELECT payload FROM aqte_ticks WHERE kind='future' AND received>=? "
                                  "ORDER BY received,id", (start,)):
                tick = Tick(**json.loads(row["payload"]))
                if self.engine.fresh(tick, tick.received):
                    self.engine.book.add(tick)
            if not self.engine.paper_enabled:
                for (kind, token), tick in self.engine.book.previous.items():
                    if kind != "future":
                        continue
                    key = (kind, token, 60)
                    minutes = {bar["at"] for bar in self.engine.book.closed[key] if session(bar["at"])}
                    current = self.engine.book.current.get(key)
                    if current and session(current["at"]):
                        minutes.add(current["at"])
                    if minutes:
                        self.gaps[token] = dict(symbol=tick.symbol, kind=kind, minutes=minutes,
                                                reason="Restored futures candles await exchange verification",
                                                resume_after=tick.received, last_lost_at=tick.at)
                        self.metrics.increment("restored_candles_unverified", len(minutes))
            # Only raw ticks expire. Audit and completed paper trades are retained.
            db.execute("DELETE FROM aqte_ticks WHERE received < ?", (time.time() - 7 * 86400,))

    def journal_record(self):
        state = dict(orders=self.engine.orders, killed=self.engine.killed, last_setup=self.engine.last_setup)
        return dict(contracts={token: asdict(c) for token, c in self.engine.contracts.items()},
                    events=copy.deepcopy(self.engine.events),
                    state=copy.deepcopy(state) if self.engine.paper_enabled else None)

    def persist(self, db, ticks=(), record=None):
        record = record if record is not None else self.journal_record()
        db.executemany("INSERT INTO aqte_ticks(at,received,symbol,kind,token,payload) VALUES(?,?,?,?,?,?)",
                       [(t.at, t.received, t.symbol, t.kind, t.token, json.dumps(asdict(t))) for t in ticks])
        contracts = {token: json.dumps(contract) for token, contract in record["contracts"].items()}
        db.executemany("INSERT INTO aqte_contracts VALUES(?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload",
                       [(token, payload) for token, payload in contracts.items()
                        if self.persisted_contracts.get(token) != payload])
        contract_days = {(day(t.received), t.token) for t in ticks
                         if t.kind == "option" and t.token in contracts}
        db.executemany("INSERT INTO aqte_contract_history VALUES(?,?,?) "
                       "ON CONFLICT(session_day,token) DO NOTHING",
                       [(date, token, contracts[token])
                        for date, token in contract_days])
        for event in record["events"]:
            db.execute("INSERT INTO aqte_events VALUES(?,?,?,?)",
                       (event["id"], event["at"], event["kind"], json.dumps(event)))
            if event["kind"] == "CLOSED":
                trade = event["trade"]
                db.execute("INSERT INTO aqte_trades VALUES(?,?,?)",
                           (trade["id"], trade["exit_at"], json.dumps(trade)))
        if record["state"] is not None:
            db.execute("INSERT INTO aqte_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload",
                       (json.dumps(record["state"]),))
        self.persisted_contracts = contracts

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
                        recorded = []
                        for tick in batch:
                            try:
                                validate_tick(tick)
                            except (ValueError, TypeError, OverflowError):
                                logger.exception("AQTE rejected invalid queued packet; it will not enter recovery history")
                                self.mark_gap(tick.symbol, tick.kind, tick.token, time.time(), "Invalid queued packet",
                                              received=time.time())
                                continue
                            recorded.append(tick)
                            if self.engine.fresh(tick, time.time()):
                                try:
                                    with self.metrics.measure("tick.processing"):
                                        accepted = self.engine.ingest(tick)
                                    if accepted:
                                        with self.health_lock:
                                            gap = self.gaps.get(tick.token)
                                            if gap and tick.kind == "future" and gap.get("resume_after") is not None and (
                                                tick.received >= gap["resume_after"] and tick.at >= gap["last_lost_at"]
                                            ):
                                                # The first resumed volume delta can include trades from lost minutes.
                                                gap["minutes"].add(int(tick.at // 60) * 60)
                                                gap["resume_after"] = None
                                        self.capture_ml(tick)
                                        with self.metrics.measure("signals.capture"):
                                            self.capture_signals(time.time())
                                        self.last_tick_at, self.last_received_at = tick.at, tick.received
                                        with self.health_lock:
                                            if tick.kind != "future" and self.gaps.pop(tick.token, None):
                                                self.metrics.increment("feed_recoveries")
                                    self.metrics.increment("ticks_accepted" if accepted else "ticks_rejected")
                                except (ValueError, TypeError, OverflowError):
                                    logger.exception("AQTE rejected invalid %s packet for %s", tick.kind, tick.symbol)
                                    self.mark_gap(tick.symbol, tick.kind, tick.token, tick.at, "Invalid market packet",
                                                  received=tick.received)
                                self.metrics.observe("tick.queue_age", max(0, time.time() - tick.received) * 1000)
                            else:
                                self.mark_gap(tick.symbol, tick.kind, tick.token, tick.at, "Queue exceeded quote freshness",
                                              received=tick.received)
                                self.engine.event("PROCESSING_STALE_TICK", time.time(),
                                                  token=tick.token, reason="Queued quote too old for execution")
                        self.retire_gaps()
                        self.engine.manage(time.time())
                        if not batch:
                            self.capture_signals(time.time())
                        record = self.journal_record()
                        if self.engine.paper_enabled:
                            # Paper kill/state writes retain their original ordering under the market lock.
                            with self.metrics.measure("journal.commit"), db:
                                self.persist(db, recorded, record)
                            record = None
                        self.engine.events.clear()
                    while record is not None:
                        try:
                            with self.metrics.measure("journal.commit"), db:
                                self.persist(db, recorded, record)
                            if self.failed.is_set():
                                with self.lock:
                                    self.failed.clear()
                                    self.engine.fault = None
                                self.metrics.increment("journal_recoveries")
                            break
                        except sqlite3.Error:
                            self.persisted_contracts.clear()
                            if not self.failed.is_set():
                                logger.exception("AQTE journal unavailable; entries blocked while the same batch retries")
                            self.failed.set()
                            with self.lock:
                                self.engine.fault = "AQTE journal unavailable; recovery in progress"
                            if self.stop_event.wait(1):
                                return
                    if batch:
                        self.schedule_engines()
                        self.notify()
        except Exception:
            self.failed.set()
            logger.exception("AQTE worker stopped; paper execution is blocked")
            with self.lock:
                self.engine.fault = "AQTE journal/processing failure; restart required"

    async def start(self):
        if self.started:
            return
        await asyncio.to_thread(self.initialize)
        if self.ml_model_path is not None:
            await asyncio.to_thread(self.load_ml)
        self.stop_event.clear()
        self.started = True
        self.evaluators = EngineWorkers(self.metrics, self.notify)
        self.worker = threading.Thread(target=self.run, name="aqte-analysis", daemon=True)
        self.worker.start()
        self.refresh_task = asyncio.create_task(self.refresh(), name="aqte-subscriptions")
        if self.ml_model is not None:
            self.ml_task = asyncio.create_task(self.refresh_ml(), name="aqte-ml-shadow")

    async def stop(self):
        if self.ml_task:
            self.ml_task.cancel()
            try:
                await self.ml_task
            except asyncio.CancelledError:
                pass
        if self.refresh_task:
            self.refresh_task.cancel()
            try:
                await self.refresh_task
            except asyncio.CancelledError:
                pass
        self.stop_event.set()
        if self.worker:
            await asyncio.to_thread(self.worker.join)
        if self.evaluators:
            await asyncio.to_thread(self.evaluators.close)
            self.evaluators = None
        self.started = False

    def notify(self):
        listener = self.listener
        if listener is not None:
            listener()

    def capture_signals(self, now):
        snapshot = self.engine.snapshot(now)
        with self.health_lock:
            recovering = {gap["symbol"] for gap in self.gaps.values()}
        for symbol, signal in snapshot["data"].items():
            candidates = (("swing", signal), ("scalp", {**signal, **(signal.get("scalp") or {})}))
            for style, candidate in candidates:
                identity = (symbol, style)
                qualified = symbol not in recovering and self.feed_connected is not False and (
                    candidate.get("decision") in ("BUY CE", "BUY PE") and candidate.get("entry"))
                key = opportunity_key(symbol, candidate) if qualified else None
                previous = self.signal_states.get(identity)
                if previous and previous["key"] != key:
                    reasons = (["Feed recovery in progress"] if symbol in recovering else
                               ["Shared Kite feed disconnected"] if self.feed_connected is False else
                               candidate.get("reasons", []))
                    self.engine.event("OPPORTUNITY_EXPIRED", now, key=previous["key"], symbol=symbol, style=style,
                                      reason="Rule qualification ended; correlate the key with the live submission audit",
                                      rule_reasons=reasons, last_qualified_at=previous["at"])
                    self.signal_events.append(copy.deepcopy(self.engine.events[-1]))
                    self.metrics.increment("signals.expired")
                if key:
                    if previous is None or previous["key"] != key:
                        self.engine.event("OPPORTUNITY_GENERATED", now, key=key, symbol=symbol, style=style,
                                          strategy=candidate.get("strategy"), score=candidate.get("confidence"),
                                          token=candidate["contract"]["token"], entry=copy.deepcopy(candidate["entry"]))
                        self.signal_events.append(copy.deepcopy(self.engine.events[-1]))
                        self.metrics.increment("signals.generated")
                    self.signal_states[identity] = dict(key=key, at=now)
                else:
                    self.signal_states.pop(identity, None)

    def mark_gap(self, symbol, kind, token, at, reason, *, received=None):
        with self.health_lock:
            if token not in self.gaps:
                logger.warning("AQTE %s %s recovering: %s", symbol, kind, reason)
                self.gaps[token] = dict(symbol=symbol, kind=kind, minutes=set(), reason=reason)
            self.gaps[token]["minutes"].add(int(at // 60) * 60)
            if kind == "future" and received is not None:
                gap = self.gaps[token]
                gap["resume_after"] = max(gap.get("resume_after") or received, received)
                gap["last_lost_at"] = max(gap.get("last_lost_at", at), at)
        self.metrics.increment("feed_packets_lost")

    def retire_gaps(self):
        with self.lock, self.health_lock:
            for token, gap in list(self.gaps.items()):
                retired = False
                if gap["kind"] == "future":
                    future = self.engine.future.get(gap["symbol"])
                    retired = future is not None and future.token != token
                    bars = self.engine.book.closed.get(("future", token, 60), ())
                    gap["minutes"] = {at for at in gap["minutes"] if session(at) and (not bars or at >= bars[0]["at"])}
                    retired = retired or (not gap["minutes"] and gap.get("resume_after") is None)
                elif gap["kind"] == "option":
                    retired = token not in self.engine.contracts and token not in self.subscribed
                if retired:
                    self.gaps.pop(token)
                    logger.info("AQTE retired %s recovery marker for %s; it no longer affects retained inputs",
                                gap["kind"], gap["symbol"])
                    self.metrics.increment("feed_gaps_retired")

    def enqueue(self, symbol, kind, raw):
        # The shared feed also routes non-AQTE indices (e.g. INDIAVIX) here; the engine rejects them.
        if not self.started or symbol not in SYMBOLS:
            return
        if self.morning is not None:
            self.morning.enqueue(symbol, kind, raw)
        try:
            tick = normalize(symbol, kind, raw, time.time())
            if not self.engine.fresh(tick, tick.received):
                logger.warning("AQTE rejected stale/future exchange timestamp for %s %s", symbol, kind)
                self.metrics.increment("exchange_timestamps_rejected")
                return
            self.queue.put_nowait(tick)
        except queue.Full:
            self.mark_gap(symbol, kind, tick.token, tick.at, "Bounded tick queue overflow", received=tick.received)
            self.metrics.increment("queue_overflow")
        except (ValueError, TypeError, KeyError, OverflowError):
            logger.exception("AQTE rejected malformed %s tick for %s", kind, symbol)
            token = raw.get("instrument_token")
            if type(token) is int and token > 0:
                self.mark_gap(symbol, kind, token, time.time(), "Malformed market packet", received=time.time())
            self.metrics.increment("malformed_ticks")

    def option_tick(self, raw):
        # Contract maps are replaced atomically, never mutated by the worker.
        # Do not let journal I/O block the shared KiteTicker callback.
        if self.vix_token is not None and raw.get("instrument_token") == self.vix_token:
            self.record_vix(raw)
            return True
        contract = self.engine.contracts.get(raw.get("instrument_token"))
        if contract:
            if self.morning is not None:
                self.morning.enqueue(contract.symbol, "option", raw)
            self.enqueue(contract.symbol, "option", raw)
            return True
        return False

    def record_vix(self, raw, received=None):
        received = time.time() if received is None else received
        try:
            price = float(raw["last_price"])
            close = float((raw.get("ohlc") or {}).get("close") or 0)
            at = exchange_time(raw, received, "spot")
        except (KeyError, TypeError, ValueError):
            logger.warning("AQTE ignored malformed India VIX tick")
            return
        if not math.isfinite(price) or price <= 0:
            return
        change = (price - close) / close * 100 if math.isfinite(close) and close > 0 else None
        with self.lock:
            self.vix = dict(token=int(raw["instrument_token"]), price=price, close=close or None,
                            change_pct=round(change, 2) if change is not None else None, at=at, received=received)

    def resolve_vix(self, kite):
        """Resolve the verified India VIX token once per day; failures leave VIX unavailable."""
        today = day(time.time())
        if self.vix_day == today and self.vix_token:
            return
        try:
            self.vix_token = int(kite.ltp([VIX_INSTRUMENT])[VIX_INSTRUMENT]["instrument_token"])
            self.vix_day = today
        except Exception as exc:
            # Broker boundary: VIX is display/engine context only, never an entry requirement.
            logger.warning("AQTE India VIX token unavailable (%s)", type(exc).__name__)

    def configure(self, kite, socket, prices=None, previous_day=None, force=False):
        """Called on the existing Kite connection and each minute for ATM rotation."""
        if not self.started:
            return
        force = force or self.socket is not socket
        self.kite, self.socket = kite, socket
        try:
            today = day(time.time())
            if self.catalog_day != today:
                now = datetime.fromtimestamp(time.time(), IST)
                catalog = []
                for exchange in ("NFO", "BFO"):
                    try:
                        catalog.extend(self.instrument_catalog.get(kite, exchange, now))
                        self.catalog_errors.pop(exchange, None)
                    except Exception as exc:
                        self.catalog_errors[exchange] = f"Instrument master unavailable ({type(exc).__name__})"
                self.catalog = [i for i in catalog if i.get("name") in SYMBOLS and
                                i.get("instrument_type") in ("CE", "PE")]
                self.catalog_day = today if not self.catalog_errors else None
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
            self.resolve_vix(kite)
            if self.vix_token:
                tokens.add(self.vix_token)
            added = tokens if force else tokens - self.subscribed
            if added:
                socket.subscribe(sorted(added))
                socket.set_mode(socket.MODE_FULL, sorted(added))
                self.metrics.increment("subscription_requests")
            removed = self.subscribed - tokens
            if removed:
                socket.unsubscribe(sorted(removed))
            with self.lock:
                if previous_day is not None:
                    self.engine.previous_day = {symbol: copy.deepcopy(values) for symbol, values in previous_day.items()
                                                if values.get("prepared_for") in (None, today)}
                self.subscribed = tokens
                self.subscription_error = None
                self.configured_days = {exchange: value for exchange, value in self.instrument_catalog.days.items()
                                        if value == today}
        except Exception as exc:
            # Broker boundary: retain old subscriptions and never invent contracts.
            logger.exception("AQTE option subscriptions unavailable")
            with self.lock:
                self.subscription_error = f"Option subscription failed ({type(exc).__name__})"
        self.backfill(kite)
        with self.lock:
            tokens = self.future_tokens()
            for token, symbol in tokens.items():
                if symbol in SYMBOLS:
                    self.features.get(self.engine.book, token, time.time(), self.engine.previous_day.get(symbol))
            self.features.retain(set(tokens))
            self.prepared_at = time.time()

    def backfill(self, kite, futures=None, now=None):
        """Heal the futures one-minute warm-up from Kite exchange history after restarts or feed gaps.

        Only completed regular-session minutes are merged; the forming minute and the latest live bars stay
        authoritative. Failures leave live-only warm-up unchanged and retry after five minutes.
        """
        now = time.time() if now is None else now
        dt = datetime.fromtimestamp(now, IST)
        from config.nse_holidays import is_holiday
        if dt.weekday() >= 5 or is_holiday(day(now)) or not OPEN_MINUTE - 30 <= minute_of_day(now) < CLOSE_MINUTE:
            return 0
        if futures is None:
            futures = self.future_tokens()
        with self.lock, self.health_lock:
            self.retire_gaps()
            wanted = {int(token): symbol for token, symbol in futures.items() if symbol in SYMBOLS and
                      now >= self.history_retry.get(int(token), 0) and (token in self.gaps or warmup_count(
                          self.engine.book.closed[("future", int(token), 60)], now) < WARMUP_CANDLES)}
        if not wanted:
            return 0
        added = 0
        failures = False
        for token, symbol in wanted.items():
            try:
                rows = kite.historical_data(token, datetime.fromtimestamp(now - 14 * 86400, IST).replace(tzinfo=None),
                                            dt.replace(tzinfo=None), "minute")
                bars = []
                for row in rows:
                    at = row["date"]
                    at = datetime.fromisoformat(at) if isinstance(at, str) else at
                    at = (at if at.tzinfo else at.replace(tzinfo=IST)).timestamp()
                    values = [float(row[k]) for k in ("open", "high", "low", "close")]
                    if all(math.isfinite(v) and v > 0 for v in values) and values[2] <= min(values) and values[1] >= max(values):
                        bars.append(dict(at=at, open=values[0], high=values[1], low=values[2], close=values[3],
                                         volume=max(0, int(row.get("volume") or 0))))
                with self.lock, self.health_lock:
                    merged = self.engine.seed_bars(token, bars, now)
                    gap = self.gaps.get(token)
                    if gap:
                        closed = {b["at"]: b for b in self.engine.book.closed[("future", token, 60)]}
                        repaired = {b["at"] for b in bars if b["at"] < int(now // 60) * 60 - 120
                                    and b["at"] in closed and all(closed[b["at"]].get(k) == b[k]
                                                                 for k in ("open", "high", "low", "close", "volume"))}
                        gap["minutes"].difference_update(repaired)
                        if not gap["minutes"] and gap.get("resume_after") is None:
                            self.gaps.pop(token)
                            self.metrics.increment("feed_recoveries")
                    self.retire_gaps()
                    self.history_errors.pop(symbol, None)
                    self.history_retry[token] = now + 60
                added += merged
                if merged:
                    logger.info("AQTE warm-up backfilled %d one-minute %s futures candles from Kite history",
                                merged, symbol)
            except Exception as exc:
                logger.warning("AQTE %s warm-up backfill unavailable (%s); other indices continue", symbol, type(exc).__name__)
                self.history_errors[symbol] = f"Historical API unavailable ({type(exc).__name__})"
                self.history_retry[token] = now + 300
                failures = True
        self.backfill_after = now + (300 if failures or not added else 60)
        return added

    def future_tokens(self):
        from services.market_feed import FUT_TOKEN_MAP
        tokens = dict(FUT_TOKEN_MAP)
        for symbol, tick in self.engine.future.items():
            if symbol not in tokens.values():
                tokens[tick.token] = symbol
        return tokens

    def attach(self, kite, socket, prices, previous_day):
        self.configured_days.clear()
        self.connection = (kite, socket, copy.deepcopy(prices), copy.deepcopy(previous_day))
        self.set_feed_connection(True)

    def set_feed_connection(self, connected):
        self.feed_connected = connected
        if connected:
            self.connection_at = time.time()
            self.metrics.increment("feed_connections")
        else:
            self.metrics.increment("feed_disconnects")
            for tick in list(self.engine.future.values()):
                self.mark_gap(tick.symbol, "future", tick.token, tick.at,
                              "Shared Kite feed disconnected", received=time.time())
        self.notify()

    def load_ml(self):
        self.ml_model = None
        self.ml_state["observations"] = {}
        self.ml_state.pop("model_id", None)
        try:
            model = ShadowModel.load(self.ml_model_path)
        except (ValueError, OSError, ImportError, KeyError, TypeError) as exc:
            logger.exception("AQTE shadow model unavailable; rules and orders are unchanged")
            self.ml_state.update(status="UNAVAILABLE", error=f"Shadow model load failed ({type(exc).__name__})")
            return
        self.ml_model = model
        self.ml_seen.clear()
        self.ml_candidates.clear()
        self.ml_state.update(status="READY", error=None, model_id=model.model_id)

    def capture_ml(self, tick):
        if self.ml_model is None:
            return
        signal = self.engine.signals.get(tick.symbol)
        if not signal or signal["decision"] == "WAIT" or not signal["entry"]:
            return
        candle_at = signal["intelligence"]["at"]
        if self.ml_seen.get(tick.symbol) == candle_at:
            return
        self.ml_seen[tick.symbol] = candle_at
        candidate = copy.deepcopy(signal)
        candidate["spot"] = self.engine.spot[tick.symbol].price
        self.ml_candidates[tick.symbol] = (candidate, self.engine.options[signal["contract"]["token"]])

    def score_ml(self):
        with self.lock:
            candidates = self.ml_candidates
            self.ml_candidates = {}
            model = self.ml_model
        if model is None:
            return
        for symbol, (signal, quote) in candidates.items():
            try:
                if not 0 <= time.time() - signal["at"] <= self.engine.policy.stale_seconds:
                    raise MLUnavailable("Shadow candidate expired before background scoring")
                result = model.predict(signal, quote)
                record = dict(schema=SCHEMA, symbol=symbol, **result,
                              features=dict(zip(FEATURE_NAMES, feature_vector(signal, quote))))
                with self.path.with_name("aqte-ml-shadow.jsonl").open("a", encoding="utf-8") as stream:
                    stream.write(json.dumps(record, allow_nan=False) + "\n")
            except MLUnavailable as exc:
                logger.warning("AQTE shadow prediction unavailable for %s: %s", symbol, exc)
                result = dict(status="UNAVAILABLE", observed_at=signal["at"], error=str(exc))
            except (OSError, ImportError, ValueError, TypeError) as exc:
                logger.exception("AQTE shadow inference/recording failed; rules and orders are unchanged")
                with self.lock:
                    self.ml_model = None
                    self.ml_state["observations"] = {}
                    self.ml_state.update(status="UNAVAILABLE", error=f"Shadow scoring failed ({type(exc).__name__})")
                return
            with self.lock:
                self.ml_state["observations"][symbol] = result

    async def refresh_ml(self):
        while self.ml_model is not None:
            await asyncio.sleep(1)
            await asyncio.to_thread(self.score_ml)

    async def refresh(self):
        active = None
        refreshed = 0
        while True:
            await asyncio.sleep(1)
            connection = self.connection
            if connection is not None and (connection is not active or time.monotonic() - refreshed >= 60):
                kite, socket, prices, previous_day = connection
                if socket.is_connected():
                    await asyncio.to_thread(self.configure, kite, socket, prices, previous_day, connection is not active)
                    active, refreshed = connection, time.monotonic()

    def snapshot(self):
        with self.metrics.measure("snapshot"), self.lock:
            result = copy.deepcopy(self.engine.snapshot(time.time()))
            result["subscription_error"] = self.subscription_error
            result["recording"] = self.started and not self.failed.is_set()
            result["ml"] = copy.deepcopy(self.ml_state)
            if self.failed.is_set() or not self.started or self.feed_connected is False:
                for signal in result["data"].values():
                    reason = "Shared Kite feed disconnected" if self.feed_connected is False else "AQTE recorder unavailable"
                    signal.update(decision="WAIT", entry=None, reasons=[reason], feed_ready=False)
                    signal["scalp"] = self.engine.idle_scalp(reason)
                    signal["rule_checks"] = None
            with self.health_lock:
                blocked = {gap["symbol"]: gap["reason"] for gap in self.gaps.values()}
            for symbol, reason in blocked.items():
                signal = result["data"][symbol]
                signal.update(decision="WAIT", entry=None, reasons=[f"Feed recovery: {reason}"], feed_ready=False)
                signal["scalp"] = self.engine.idle_scalp(f"Feed recovery: {reason}")
                signal["rule_checks"] = None
            if self.evaluators is not None:
                for symbol, signal in result["data"].items():
                    exchange = "BFO" if symbol == "SENSEX" else "NFO"
                    if self.configured_days.get(exchange) != day(time.time()) or self.subscription_error:
                        reason = self.subscription_error or self.catalog_errors.get(
                            exchange, "Today's instrument master is not prepared")
                        signal.update(decision="WAIT", entry=None, reasons=[reason], feed_ready=False, rule_checks=None)
                        signal["scalp"] = self.engine.idle_scalp(reason)
            if self.evaluators is None:
                self.attach_engines_safely(result)
            else:
                self.attach_cached_engines(result)
            if self.morning is not None:
                morning = self.morning.snapshot()
                for symbol, signal in result["data"].items():
                    signal["morning"] = morning["signals"].get(symbol)
            return result

    def schedule_engines(self):
        if self.evaluators is None:
            return
        now = time.time()
        with self.lock:
            snapshot = copy.deepcopy(self.engine.snapshot(now))
            inputs = []
            bars, peers = {}, {}
            for symbol in SYMBOLS:
                future = self.engine.future.get(symbol)
                bars[symbol] = list(self.engine.book.closed.get(("future", future.token, 60), ())) if future else []
                peers[symbol] = session_change(bars[symbol], now) if (
                    future and self.engine.fresh(future, now)) else None
            vix = copy.deepcopy(self.vix) if self.vix and 0 <= now - self.vix["received"] <= VIX_STALE_SECONDS else None
            for symbol, signal in snapshot["data"].items():
                future, spot = self.engine.future.get(symbol), self.engine.spot.get(symbol)
                if future is None:
                    continue
                partial = self.features.get(self.engine.book, future.token, future.at, self.engine.previous_day.get(symbol))
                options = [(c, self.engine.options[token]) for token, c in self.engine.contracts.items()
                           if c.symbol == symbol and self.engine.fresh(self.engine.options.get(token), now)]
                observation = self.ml_state["observations"].get(symbol)
                ml = None
                if observation and observation.get("probability_positive_net_return") is not None and (
                    0 <= now - observation.get("observed_at", 0) <= ML_MAX_AGE_SECONDS
                ):
                    contract = self.engine.contracts.get(observation.get("token"))
                    ml = {**observation, "side": contract.side if contract else None}
                inputs.append((symbol, signal, future.token, self.engine.book.revisions[("future", future.token, 60)],
                               dict(live=future, spot=spot, bars=bars[symbol], options=options, peers=peers,
                                    ml=ml, ml_reason=self.ml_state.get("error") or "No fresh shadow-model observation",
                                    vix=vix, policy=self.engine.policy, now=now, config=self.engine_config,
                                    partial_info=live_intelligence(partial["values"], future),
                                    timeframes=partial["timeframes"])))
        for symbol, signal, token, revision, arguments in inputs:
            try:
                with self.metrics.measure("features.advisory_inputs"):
                    jobs, metadata = prepare_evaluation(signal, **arguments)
                source_at = min(arguments["live"].at, arguments["live"].received,
                                arguments["spot"].received if arguments["spot"] else now)
                with self.lock:
                    self.contexts[symbol] = dict(at=source_at, **metadata)
                for key, job in jobs.items():
                    deadline = source_at + self.engine.policy.stale_seconds
                    if key == "options" and arguments["options"]:
                        deadline = min(deadline, min(t.at for _, t in arguments["options"]) + self.engine.policy.stale_seconds)
                    if key == "volatility_breakout" and vix:
                        deadline = min(deadline, vix["received"] + VIX_STALE_SECONDS)
                    def run(job=job, token=token, revision=revision, source_at=source_at, deadline=deadline,
                            key=key, metadata=metadata):
                        card = job()
                        if key == "options":
                            card["_metadata"] = copy.deepcopy(metadata)
                        card.update(input_at=source_at, valid_until=deadline,
                                    source_token=token, source_revision=revision)
                        return card
                    self.evaluators.submit(symbol, key, source_at, run)
            except Exception as exc:
                logger.exception("AQTE advisory input preparation failed for %s; other indices continue", symbol)
                self.metrics.increment("engine_input_errors")
                with self.lock:
                    self.contexts[symbol] = dict(at=0, error=type(exc).__name__)

    def attach_cached_engines(self, result):
        now = result["generated_at"]
        published = self.evaluators.snapshot()
        for symbol, signal in result["data"].items():
            cards = []
            option_metadata = None
            future = self.engine.future.get(symbol)
            for engine in ENGINES:
                state = published.get((symbol, engine[1]))
                card = state.get("card") if state else None
                reason = "Waiting for this engine's inputs/evaluation"
                if state and state["error"]:
                    reason = state["error"]
                elif card:
                    valid = signal["feed_ready"] and not self.contexts.get(symbol, {}).get("error") and (
                        now <= card["valid_until"]) and future and (
                        future.token == card["source_token"] and
                        self.engine.book.revisions[("future", future.token, 60)] == card["source_revision"])
                    if not valid:
                        reason, card = "Engine inputs expired or changed; awaiting fresh evaluation", None
                if card and engine[1] == "options":
                    option_metadata = card.pop("_metadata", None)
                cards.append(card if card else engine_card(engine, reason=reason))
            metadata = self.contexts.get(symbol, {})
            fresh = signal["feed_ready"] and 0 <= now - metadata.get("at", 0) <= self.engine.policy.stale_seconds
            features = option_metadata or metadata
            signal.update(engines=cards, orchestration=orchestrate(cards),
                          market=copy.deepcopy(features.get("market")) if fresh else None,
                          options=copy.deepcopy(features.get("options")) if fresh else None)
            for card in cards:
                key = (symbol, card["key"])
                previous = self.engine_states.get(key)
                if previous != card["status"] and (previous is not None or card["status"] == "SATISFIED"):
                    self.engine_events.append(dict(at=now, symbol=symbol, engine=card["id"], name=card["name"],
                                                   status=card["status"], previous=previous, side=card["side"]))
                self.engine_states[key] = card["status"]
        result["vix"] = copy.deepcopy(self.vix) if (
            self.vix and 0 <= now - self.vix["received"] <= VIX_STALE_SECONDS) else None
        result["engine_events"] = list(reversed(self.engine_events))[:20]
        result["engine_policy"] = dict(authority="ADVISORY_VETO", veto=self.engine_config.veto,
                                       veto_min=self.engine_config.veto_min, engines=len(ENGINES))

    def diagnostics(self):
        now = time.time()
        catalog = self.instrument_catalog.diagnostics()
        with self.lock, self.health_lock:
            futures = self.future_tokens()
            all_ticks = {**{t.token: t for t in self.engine.spot.values()},
                         **{t.token: t for t in self.engine.future.values()}, **self.engine.options}
            subscribed = sorted(self.subscribed | set(futures))
            missing = [token for token in subscribed if not self.engine.fresh(all_ticks.get(token), now)
                       and not (self.vix and self.vix["token"] == token and now - self.vix["received"] <= VIX_STALE_SECONDS)]
            readiness = {}
            for symbol in SYMBOLS:
                tokens = [token for token, name in futures.items() if name == symbol]
                completed = max((warmup_count(self.engine.book.closed[("future", token, 60)], now)
                                 for token in tokens), default=0)
                opening = max((warmup_count(session_bars(self.engine.book.closed[("future", token, 60)], now), now)
                               for token in tokens), default=0)
                contracts = [c.token for c in self.engine.contracts.values() if c.symbol == symbol]
                exchange = "BFO" if symbol == "SENSEX" else "NFO"
                history_verified = completed >= WARMUP_CANDLES and not any(
                    self.gaps.get(token, {}).get("minutes") for token in tokens)
                prepared = (self.configured_days.get(exchange) == day(now) and not self.subscription_error
                            and history_verified and bool(contracts)
                            and symbol in self.engine.previous_day and set(contracts).issubset(self.subscribed))
                readiness[symbol] = dict(prepared=prepared, history_completed=completed,
                                         history_verified=history_verified,
                                         history_required=WARMUP_CANDLES, futures=tokens, contracts=contracts,
                                         history_error=self.history_errors.get(symbol),
                                         live_ready=prepared and opening >= SESSION_CANDLES
                                         and self.feed_connected is True and not self.failed.is_set()
                                         and self.engine.fresh(self.engine.spot.get(symbol), now)
                                         and not any(g["symbol"] == symbol for g in self.gaps.values())
                                         and not (set(tokens + contracts) & set(missing)),
                                         opening_candles_completed=min(opening, SESSION_CANDLES),
                                         opening_candles_required=SESSION_CANDLES)
            snapshot = self.snapshot()
            return dict(
                morning=self.morning.snapshot() if self.morning is not None else None,
                generated_at=now, feed=dict(connected=self.feed_connected, connected_at=self.connection_at,
                                           last_exchange_at=self.last_tick_at, last_received_at=self.last_received_at,
                                           requested_tokens=subscribed, missing_or_stale_tokens=missing),
                queue=dict(size=self.queue.qsize(), capacity=self.queue.maxsize,
                           recovering=[{**gap, "token": token, "minutes": sorted(gap["minutes"])}
                                       for token, gap in self.gaps.items()],
                           journal_fault=self.failed.is_set()),
                preparation=dict(last_attempt_at=self.prepared_at, instruments=readiness,
                                 catalog=catalog, ml=self.ml_state["status"],
                                 strategy_count=len(ENGINES)),
                features=self.features.diagnostics(), rejected_ticks=dict(self.engine.book.rejected),
                signal_events=list(self.signal_events),
                engines=self.evaluators.diagnostics() if self.evaluators else dict(running=0, pending=0, workers=0),
                evaluations={symbol: dict(engines=signal.get("engines"), orchestration=signal.get("orchestration"))
                             for symbol, signal in snapshot["data"].items()},
                measurements=self.metrics.snapshot())

    def attach_engines_safely(self, result):
        try:
            self.attach_engines(result)
            self.engine_error = None
        except Exception as exc:
            # Advisory layer only: the authoritative scalp/swing rules and broker gates stay unchanged.
            if self.engine_error != type(exc).__name__:
                logger.exception("AQTE strategy-engine evaluation failed; entry rules are unaffected")
            self.engine_error = type(exc).__name__
            for signal in result["data"].values():
                signal.update(engines=None, orchestration=None, market=None, options=None)
            result.update(vix=None, engine_events=[], engine_policy=None)

    def attach_engines(self, result):
        """Evaluate the 12 read-only engines on the same locked state as the snapshot."""
        now = result["generated_at"]
        engine = self.engine
        bars, peers = {}, {}
        for symbol in SYMBOLS:
            future = engine.future.get(symbol)
            bars[symbol] = list(engine.book.closed.get(("future", future.token, 60), ())) if future else []
            peers[symbol] = session_change(bars[symbol], now) if bars[symbol] else None
        vix = None
        if self.vix and 0 <= now - self.vix["received"] <= VIX_STALE_SECONDS:
            vix = {key: self.vix[key] for key in ("price", "close", "change_pct", "at")}
        ml_state = result["ml"]
        ml_reason = {"DISABLED": "Shadow model not configured (AQTE_ML_SHADOW_MODEL_PATH)",
                     "UNAVAILABLE": ml_state.get("error") or "Shadow model unavailable"}.get(
            ml_state.get("status"), "Waiting for a shadow observation of a rule setup")
        for symbol, signal in result["data"].items():
            options = [(contract, engine.options[token]) for token, contract in engine.contracts.items()
                       if contract.symbol == symbol and engine.fresh(engine.options.get(token), now)]
            observation = (ml_state.get("observations") or {}).get(symbol)
            ml = None
            if observation and observation.get("probability_positive_net_return") is not None and \
                    0 <= now - observation.get("observed_at", 0) <= ML_MAX_AGE_SECONDS:
                contract = engine.contracts.get(observation.get("token"))
                ml = {**observation, "side": contract.side if contract else None}
            evaluated = evaluate(signal, live=engine.future.get(symbol), spot=engine.spot.get(symbol),
                                 bars=bars[symbol], options=options, peers=peers, ml=ml, ml_reason=ml_reason,
                                 vix=vix, policy=engine.policy, now=now, config=self.engine_config)
            signal.update(evaluated)
            if not signal.get("feed_ready"):
                continue
            for card in evaluated["engines"]:
                key = (symbol, card["key"])
                previous = self.engine_states.get(key)
                if previous != card["status"] and (previous is not None or card["status"] == "SATISFIED"):
                    self.engine_events.append(dict(at=now, symbol=symbol, engine=card["id"], name=card["name"],
                                                   status=card["status"], previous=previous, side=card["side"]))
                self.engine_states[key] = card["status"]
        result["vix"] = vix
        result["engine_events"] = list(reversed(self.engine_events))[:20]
        result["engine_policy"] = dict(authority="ADVISORY_VETO", veto=self.engine_config.veto,
                                       veto_min=self.engine_config.veto_min, engines=len(ENGINES))

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


def scalp_policy(settings):
    points, errors = parse_scalp_points(settings.aqte_scalp_points)
    if errors:
        logger.error("AQTE_SCALP_POINTS entries ignored (scalping disabled for them): %s", errors)
    return Policy(scalp_points=points, scalp_stop_ratio=settings.aqte_scalp_stop_ratio)


def engine_config(settings):
    return EngineConfig(risk_free_rate=settings.aqte_risk_free_rate, veto=settings.aqte_engine_veto,
                        veto_min=settings.aqte_engine_veto_min)


def get_aqte_service():
    global _service
    if _service is None:
        from config import get_settings

        settings = get_settings()
        _service = AQTEService(ml_model_path=settings.aqte_ml_shadow_model_path, policy=scalp_policy(settings),
                               engine_config=engine_config(settings))
    return _service

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
    AQTEEngine, CLOSE_MINUTE, Contract, IST, OPEN_MINUTE, SYMBOLS, WARMUP_CANDLES, Policy, Tick, day,
    minute_of_day, parse_scalp_points, warmup_count,
)
from services.aqte_engines import ENGINES, ML_MAX_AGE_SECONDS, EngineConfig, evaluate, session_change
from services.aqte_ml import FEATURE_NAMES, SCHEMA, MLUnavailable, ShadowModel, feature_vector

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
    return Tick(symbol=symbol, kind=kind, token=int(raw["instrument_token"]),
                price=float(raw["last_price"]), at=exchange_time(raw, received, kind),
                received=received, volume=int(raw.get("volume_traded") or 0),
                bid=float(bid.get("price") or 0), ask=float(ask.get("price") or 0),
                bid_quantity=int(bid.get("quantity") or 0), ask_quantity=int(ask.get("quantity") or 0),
                buy_depth=sum(int(level.get("quantity") or 0) for level in buys),
                sell_depth=sum(int(level.get("quantity") or 0) for level in sells), oi=raw.get("oi"))


class AQTEService:
    def __init__(self, path=None, *, paper_enabled=False, ml_model_path="", policy=None, engine_config=None):
        self.path = Path(path or os.getenv("AQTE_DB_PATH") or
                         Path(__file__).resolve().parent.parent / "data" / "aqte" / "aqte.sqlite3")
        self.engine = AQTEEngine(policy, paper_enabled=paper_enabled)
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
            # Only raw ticks expire. Audit and completed paper trades are retained.
            db.execute("DELETE FROM aqte_ticks WHERE received < ?", (time.time() - 7 * 86400,))

    def persist(self, db, ticks=()):
        db.executemany("INSERT INTO aqte_ticks(at,received,symbol,kind,token,payload) VALUES(?,?,?,?,?,?)",
                       [(t.at, t.received, t.symbol, t.kind, t.token, json.dumps(asdict(t))) for t in ticks])
        db.executemany("INSERT INTO aqte_contracts VALUES(?,?) ON CONFLICT(token) DO UPDATE SET payload=excluded.payload",
                       [(token, json.dumps(asdict(contract))) for token, contract in self.engine.contracts.items()])
        contract_days = {(day(t.received), t.token) for t in ticks
                         if t.kind == "option" and t.token in self.engine.contracts}
        db.executemany("INSERT INTO aqte_contract_history VALUES(?,?,?) "
                       "ON CONFLICT(session_day,token) DO NOTHING",
                       [(date, token, json.dumps(asdict(self.engine.contracts[token])))
                        for date, token in contract_days])
        for event in self.engine.events:
            db.execute("INSERT INTO aqte_events VALUES(?,?,?,?)",
                       (event["id"], event["at"], event["kind"], json.dumps(event)))
            if event["kind"] == "CLOSED":
                trade = event["trade"]
                db.execute("INSERT INTO aqte_trades VALUES(?,?,?)",
                           (trade["id"], trade["exit_at"], json.dumps(trade)))
        if self.engine.paper_enabled:
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
                                self.capture_ml(tick)
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
        if self.ml_model_path is not None:
            await asyncio.to_thread(self.load_ml)
        self.stop_event.clear()
        self.started = True
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
        self.started = False

    def enqueue(self, symbol, kind, raw):
        # The shared feed also routes non-AQTE indices (e.g. INDIAVIX) here; the engine rejects them.
        if not self.started or symbol not in SYMBOLS:
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
        if self.vix_token is not None and raw.get("instrument_token") == self.vix_token:
            self.record_vix(raw)
            return True
        contract = self.engine.contracts.get(raw.get("instrument_token"))
        if contract:
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
            self.resolve_vix(kite)
            if self.vix_token:
                tokens.add(self.vix_token)
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
        self.backfill(kite)

    def backfill(self, kite, futures=None, now=None):
        """Heal the futures one-minute warm-up from Kite exchange history after restarts or feed gaps.

        Only completed regular-session minutes are merged; the forming minute and the latest live bars stay
        authoritative. Failures leave live-only warm-up unchanged and retry after five minutes.
        """
        now = time.time() if now is None else now
        dt = datetime.fromtimestamp(now, IST)
        if now < self.backfill_after or dt.weekday() >= 5 or not OPEN_MINUTE - 15 <= minute_of_day(now) < CLOSE_MINUTE:
            return 0
        if futures is None:
            from services.market_feed import FUT_TOKEN_MAP
            futures = dict(FUT_TOKEN_MAP)
        with self.lock:
            futures = {**futures, **{t.token: s for s, t in self.engine.future.items()}}
            wanted = {int(token): symbol for token, symbol in futures.items() if symbol in SYMBOLS and warmup_count(
                self.engine.book.closed[("future", int(token), 60)], now) < WARMUP_CANDLES}
        if not wanted:
            return 0
        added = 0
        try:
            for token, symbol in wanted.items():
                rows = kite.historical_data(token, datetime.fromtimestamp(now - 5 * 86400, IST).replace(tzinfo=None),
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
                with self.lock:
                    merged = self.engine.seed_bars(token, bars, now)
                added += merged
                if merged:
                    logger.info("AQTE warm-up backfilled %d one-minute %s futures candles from Kite history",
                                merged, symbol)
        except Exception as exc:
            # Broker boundary: historical API may be unavailable; live ticks keep warming up.
            logger.warning("AQTE warm-up backfill unavailable (%s); live candles only", type(exc).__name__)
            self.backfill_after = now + 300
            return added
        self.backfill_after = now + (60 if added else 300)
        return added

    def attach(self, kite, socket, prices, previous_day):
        self.connection = (kite, socket, copy.deepcopy(prices), copy.deepcopy(previous_day))

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
        if self.ml_model is None or tick.kind != "future":
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
                    await asyncio.to_thread(self.configure, kite, socket, prices, previous_day)
                    active, refreshed = connection, time.monotonic()

    def snapshot(self):
        with self.lock:
            result = copy.deepcopy(self.engine.snapshot(time.time()))
            result["subscription_error"] = self.subscription_error
            result["recording"] = self.started and not self.failed.is_set()
            result["ml"] = copy.deepcopy(self.ml_state)
            if self.failed.is_set() or not self.started:
                for signal in result["data"].values():
                    signal.update(decision="WAIT", entry=None, reasons=["AQTE recorder unavailable"])
                    signal["scalp"] = self.engine.idle_scalp("AQTE recorder unavailable")
                    signal["rule_checks"] = None
            self.attach_engines_safely(result)
            return result

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

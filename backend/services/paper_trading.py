"""Chart-only paper execution. No broker client or order submission is used."""

import asyncio
import json
import logging
import math
import queue
import sqlite3
import threading
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from services.order_flow_paper import OrderFlowPaperBook

logger = logging.getLogger(__name__)
IST = timezone(timedelta(hours=5, minutes=30))
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
POLICY = {
    "mode": "PAPER ONLY",
    "stop_points": 10,
    "target_points": 20,
    "slippage_points_per_market_fill": 0.5,
    "quantity": 1,
    "fees": "Excluded: synthetic index units, not a tradable contract or broker P&L",
    "entry": "First fresh index tick AFTER chart signal receipt; never backfill the candle close",
    "target": "Resting target limit: fill at target, with no favourable gap improvement",
    "stop": "Stop-market: first observed crossing tick plus adverse slippage; gaps can exceed 10 points",
    "session": "09:15-15:30 IST, weekdays; square-off needs an observed quote",
    "source": "Only completed candles and levels from the Observatory chart; no other dashboard signals",
    "scope": "New signals require the live chart mounted; backend monitors accepted trades without a browser",
    "books": "One open trade per index / chart timeframe / strategy; books may overlap",
}


def now_ist():
    return datetime.now(IST)


def parse_time(value):
    result = datetime.fromisoformat(value) if isinstance(value, str) else value
    if result.tzinfo is None:
        result = result.replace(tzinfo=IST)
    return result.astimezone(IST)


def in_session(at):
    return at.weekday() < 5 and 555 <= at.hour * 60 + at.minute < 930


def metrics(trades):
    closed = [t for t in trades if t["exit_at"]]
    wins = [t for t in closed if t["points"] > 0]
    losses = [t for t in closed if t["points"] < 0]
    net = sum(t["points"] for t in closed)
    avg_win = sum(t["points"] for t in wins) / len(wins) if wins else None
    avg_loss = -sum(t["points"] for t in losses) / len(losses) if losses else None
    return {
        "total_trades": len(trades), "closed": len(closed), "open": len(trades) - len(closed),
        "wins": len(wins), "losses": len(losses), "breakeven": len(closed) - len(wins) - len(losses),
        "stop_hits": sum(t["exit_reason"] == "STOP_LOSS" for t in closed),
        "target_hits": sum(t["target_achieved"] for t in closed),
        "reversals": sum(t["exit_reason"] == "REVERSAL" for t in closed),
        "missed_targets": sum(t.get("missed_target", False) for t in closed),
        "net_points": round(net, 4), "pnl": round(net, 4),
        "win_rate": round(len(wins) / len(closed) * 100, 2) if closed else None,
        "expectancy": round(net / len(closed), 4) if closed else None,
        "realized_risk_reward": round(avg_win / avg_loss, 4) if avg_win and avg_loss else None,
        "planned_risk_reward": 2,
    }


class PaperTradingService:
    def __init__(self, db_path=None):
        self.db_path = Path(db_path) if db_path else Path(__file__).resolve().parent.parent / "data" / "paper_trading" / "paper_trading.sqlite3"
        self.lock = threading.RLock()
        self.queue = queue.SimpleQueue()
        self.task = None
        self.flow_task = None
        self.error = None
        self.last_received = None
        self._retry_batch = []
        self._schema_ready = False
        # Dedicated workers keep paper I/O from starving the shared asyncio thread pool.
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="paper-trading")
        self.order_flow = OrderFlowPaperBook(self)

    async def run(self, fn, *args):
        return await asyncio.get_running_loop().run_in_executor(self.executor, fn, *args)

    def _ensure_schema(self):
        if self._schema_ready:
            return
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        db = sqlite3.connect(str(self.db_path), timeout=10)
        try:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                    CREATE TABLE IF NOT EXISTS signals (
                        id TEXT PRIMARY KEY, day TEXT NOT NULL, symbol TEXT NOT NULL,
                        timeframe INTEGER NOT NULL, strategy TEXT NOT NULL, status TEXT NOT NULL,
                        payload TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS trades (
                        id TEXT PRIMARY KEY, day TEXT NOT NULL, symbol TEXT NOT NULL,
                        status TEXT NOT NULL, payload TEXT NOT NULL
                    );
                    CREATE TABLE IF NOT EXISTS events (
                        id INTEGER PRIMARY KEY, trade_id TEXT NOT NULL,
                        at TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL
                    );
                    CREATE INDEX IF NOT EXISTS trade_day ON trades(day);
                    CREATE INDEX IF NOT EXISTS trade_monitor ON trades(symbol, status, day);
                    CREATE INDEX IF NOT EXISTS event_trade ON events(trade_id, id);
                    CREATE INDEX IF NOT EXISTS signal_pending ON signals(symbol, status);
                    CREATE TABLE IF NOT EXISTS quotes (symbol TEXT PRIMARY KEY, payload TEXT NOT NULL);
                    CREATE TABLE IF NOT EXISTS reports (day TEXT PRIMARY KEY, payload TEXT NOT NULL);
                """)
            self.order_flow.schema(db)
        finally:
            db.close()
        self._schema_ready = True

    @contextmanager
    def connect(self, write=False):
        """Readers use WAL snapshots; only writers serialize on the service lock."""
        if not self._schema_ready:
            with self.lock:
                self._ensure_schema()
        if write:
            with self.lock:
                with self._open() as db:
                    yield db
        else:
            with self._open() as db:
                yield db

    @contextmanager
    def _open(self):
        db = sqlite3.connect(str(self.db_path), timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def _event(self, db, trade, at, kind, **details):
        db.execute("INSERT INTO events(trade_id, at, kind, payload) VALUES (?,?,?,?)",
                   (trade["id"], at.isoformat(), kind, json.dumps(details)))

    def _save(self, db, trade):
        status = "OPEN" if not trade["exit_at"] else (
            "TRACKING" if not trade["target_achieved"] and not trade.get("target_after_exit") else "CLOSED")
        db.execute("INSERT INTO trades VALUES (?,?,?,?,?) "
                   "ON CONFLICT(id) DO UPDATE SET status=excluded.status, payload=excluded.payload",
                   (trade["id"], trade["day"], trade["symbol"], status, json.dumps(trade)))

    def submit(self, frame, at=None):
        at = at or now_ist()
        candle_at = parse_time(frame["candle_at"])
        duration = timedelta(minutes=frame["timeframe"])
        if not in_session(at) or candle_at.date() != at.date() or not (
            candle_at + duration <= at < candle_at + duration * 2
        ):
            raise ValueError("Only fresh completed candles from the current live session are accepted")
        accepted = 0
        with self.connect(write=True) as db:
            for signal in frame["signals"]:
                key = f'{frame["symbol"]}:{frame["timeframe"]}:{candle_at.isoformat()}:{signal["strategy"]}:{signal["side"]}'
                payload = {
                    **frame, **signal, "signals": None, "id": key,
                    "received_at": at.isoformat(),
                    "expires_at": (candle_at + duration * 2).isoformat(),
                }
                cursor = db.execute("INSERT OR IGNORE INTO signals VALUES (?,?,?,?,?,?,?)",
                                    (key, at.date().isoformat(), frame["symbol"], frame["timeframe"],
                                     signal["strategy"], "PENDING", json.dumps(payload)))
                accepted += cursor.rowcount
        return {"accepted": accepted, "duplicates": len(frame["signals"]) - accepted}

    def enqueue_tick(self, symbol, tick):
        if symbol not in SYMBOLS:
            return
        received = now_ist()
        source_at = tick.get("exchange_timestamp") or received
        price = float(tick.get("last_price") or 0)
        if not math.isfinite(price) or price <= 0:
            raise ValueError(f"Invalid paper quote for {symbol}")
        self.queue.put((symbol, price, parse_time(source_at),
                        received, "exchange" if tick.get("exchange_timestamp") else "receipt"))

    def enqueue_futures_tick(self, symbol, tick):
        if symbol not in SYMBOLS:
            raise ValueError("Invalid futures paper symbol")
        # Entries require real exchange timestamps, never a receipt-time substitute.
        source_at = tick.get("exchange_timestamp")
        if source_at is None:
            logger.warning("Futures paper tick missing exchange timestamp for %s", symbol)
            return
        self.order_flow.enqueue(symbol, int(tick["instrument_token"]), float(tick["last_price"]),
                                parse_time(source_at).timestamp(), now_ist().timestamp())

    def _close(self, db, trade, price, at, reason):
        direction = 1 if trade["side"] == "BUY" else -1
        fill = trade["target"] if reason == "TARGET" else price - direction * 0.5
        trade.update(
            exit_at=at.isoformat(), exit_price=round(fill, 4), exit_trigger_price=price,
            exit_reason=reason, target_achieved=reason == "TARGET",
            points=round(direction * (fill - trade["entry_price"]), 4),
        )
        trade["pnl"] = trade["points"]
        trade["missed_target"] = reason != "TARGET" and trade["mfe"] >= 18
        self._event(db, trade, at, "EXIT", price=fill, trigger_price=price, reason=reason,
                    points=trade["points"], pnl=trade["pnl"])
        self._save(db, trade)

    def process_tick(self, symbol, price, at, received=None, timestamp_source="exchange"):
        with self.connect(write=True) as db:
            self._process_tick(db, symbol, price, at, received, timestamp_source)

    def _process_tick(self, db, symbol, price, at, received=None, timestamp_source="exchange"):
        received = received or at
        if not math.isfinite(price) or price <= 0:
            raise ValueError("Paper trading received an invalid index quote")
        if not -2 <= (received - at).total_seconds() <= 30:
            logger.warning("Paper trading rejected stale/future quote for %s at %s", symbol, at)
            return
        previous = db.execute("SELECT payload FROM quotes WHERE symbol=?", (symbol,)).fetchone()
        old = json.loads(previous["payload"]) if previous else None
        if old and (at < parse_time(old["at"]) or
                    at == parse_time(old["at"]) and price == old["price"]):
            return
        quote = {"price": price, "at": at.isoformat(), "received_at": received.isoformat(),
                 "timestamp_source": timestamp_source}
        db.execute("INSERT OR REPLACE INTO quotes VALUES (?,?)", (symbol, json.dumps(quote)))
        trades = [json.loads(row["payload"]) for row in db.execute(
            "SELECT payload FROM trades WHERE symbol=? AND "
            "(status='OPEN' OR (status='TRACKING' AND day=?))", (symbol, at.date().isoformat()))]
        for trade in trades:
            direction = 1 if trade["side"] == "BUY" else -1
            if trade["exit_at"]:
                if (trade["day"] == at.date().isoformat() and not trade["target_achieved"]
                        and not trade.get("target_after_exit") and direction * (price - trade["target"]) >= 0):
                    trade.update(target_after_exit=True, missed_target=True)
                    self._event(db, trade, at, "MISSED_TARGET_AFTER_EXIT", price=price)
                    self._save(db, trade)
                continue
            if old and (at - parse_time(old["at"])).total_seconds() > 30:
                trade["data_gaps"] = trade.get("data_gaps", 0) + 1
                self._event(db, trade, at, "DATA_GAP", previous_quote_at=old["at"],
                            resumed_price=price, note="Intratick stop/target path is unknown")
            move = direction * (price - trade["entry_price"])
            if move > trade["mfe"]:
                trade.update(mfe=round(move, 4), mfe_at=at.isoformat())
            if -move > trade["mae"]:
                trade.update(mae=round(-move, 4), mae_at=at.isoformat())
            for kind, condition in (("NEAR_TARGET", 0 < direction * (trade["target"] - price) <= 2),
                                    ("NEAR_STOP", 0 < direction * (price - trade["stop"]) <= 2)):
                if condition and kind not in trade["near_events"]:
                    trade["near_events"].append(kind)
                    self._event(db, trade, at, kind, price=price)
            reason = (
                "SESSION_CLOSE_DELAYED" if trade["day"] != at.date().isoformat() else
                "SESSION_CLOSE" if not in_session(at) else
                "STOP_LOSS" if direction * (price - trade["stop"]) <= 0 else
                "TARGET" if direction * (price - trade["target"]) >= 0 else None
            )
            if reason:
                self._close(db, trade, price, at, reason)
            else:
                trade.update(last_price=price, unrealized_points=round(move, 4))
                self._save(db, trade)
        pending = db.execute(
            "SELECT * FROM signals WHERE symbol=? AND status='PENDING' ORDER BY rowid", (symbol,)
        ).fetchall()
        for row in pending:
            signal = json.loads(row["payload"])
            if at >= parse_time(signal["expires_at"]) or not in_session(at):
                db.execute("UPDATE signals SET status='EXPIRED' WHERE id=?", (row["id"],))
                continue
            # A chart message cannot execute against a quote observed before receipt.
            if received <= parse_time(signal["received_at"]) or at < parse_time(signal["received_at"]):
                continue
            book = [t for t in trades if not t["exit_at"] and
                    t["timeframe"] == signal["timeframe"] and t["strategy"] == signal["strategy"]]
            if book and book[0]["side"] == signal["side"]:
                db.execute("UPDATE signals SET status='ALREADY_OPEN' WHERE id=?", (row["id"],))
                continue
            for trade in book:
                self._event(db, trade, at, "REVERSAL_SIGNAL", signal_id=signal["id"], price=price)
                self._close(db, trade, price, at, "REVERSAL")
            direction = 1 if signal["side"] == "BUY" else -1
            fill = round(price + direction * 0.5, 4)
            trade = {
                "id": signal["id"], "day": at.date().isoformat(), "symbol": symbol,
                "timeframe": signal["timeframe"], "strategy": signal["strategy"],
                "side": signal["side"], "signal_price": signal["signal_price"],
                "signal_at": signal["candle_at"], "received_at": signal["received_at"],
                "entry_at": at.isoformat(), "entry_price": fill, "trigger_price": price,
                "timestamp_source": timestamp_source,
                "data_gaps": 0,
                "stop": round(fill - direction * 10, 4), "target": round(fill + direction * 20, 4),
                "exit_at": None, "exit_price": None, "exit_reason": None,
                "target_achieved": False, "missed_target": False,
                "points": None, "pnl": None, "mfe": 0, "mae": 0.5,
                "mfe_at": at.isoformat(), "mae_at": at.isoformat(), "near_events": [],
                "last_price": price, "unrealized_points": -0.5,
                "rationale": signal["rationale"], "tags": signal["tags"],
                "setup": signal["setup"],
            }
            self._save(db, trade)
            self._event(db, trade, at, "ENTRY", price=fill, trigger_price=price,
                        signal_price=signal["signal_price"], stop=trade["stop"], target=trade["target"])
            trades.append(trade)
            db.execute("UPDATE signals SET status='FILLED' WHERE id=?", (row["id"],))
        self.last_received = received.isoformat()

    def snapshot(self, day=None, limit=100, offset=0, flow_offset=0):
        day = day or now_ist().date().isoformat()
        with self.connect() as db:
            all_trades = [json.loads(row["payload"]) for row in db.execute(
                "SELECT json_remove(payload, '$.setup', '$.rationale') AS payload FROM trades ORDER BY rowid DESC")]
            selected = [t for t in all_trades if t["day"] == day]
            page = [json.loads(row["payload"]) for row in db.execute(
                "SELECT payload FROM trades WHERE day=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
                (day, limit, offset))]
            ranking = self._rank(all_trades)
            daily_ranking = self._rank(selected)["strategies"]
            summary = metrics(selected)
            summary.update(best_strategy=daily_ranking[0] if daily_ranking else None,
                           worst_strategy=daily_ranking[-1] if daily_ranking else None)
            pending = dict(db.execute("SELECT status, count(*) FROM signals WHERE day=? GROUP BY status", (day,)).fetchall())
            quotes = {row["symbol"]: json.loads(row["payload"]) for row in db.execute("SELECT * FROM quotes")}
            dates = [r[0] for r in db.execute(
                "SELECT day FROM trades UNION SELECT day FROM signals UNION SELECT day FROM reports "
                "UNION SELECT day FROM of_paper ORDER BY day DESC")]
            flow_book = self.order_flow.snapshot(db, day, limit, flow_offset)
            return {
                "day": day, "policy": POLICY, "summary": summary,
                "report_status": "PROVISIONAL" if day == now_ist().date().isoformat() and in_session(now_ist())
                else "AWAITING_EXIT_QUOTES" if summary["open"] or flow_book["counts"].get("OPEN", 0) else "FINAL",
                "trades": page, "total": len(selected),
                "offset": offset, "limit": limit, "dates": dates, "rankings": ranking,
                "signals": pending, "quotes": quotes,
                "order_flow": {
                    **flow_book,
                    "running": bool(self.task and not self.task.done() and
                                    self.flow_task and not self.flow_task.done()),
                    "queued_ticks": self.order_flow.queue.qsize(),
                },
                "health": {"running": bool(self.task and not self.task.done()), "error": self.error,
                           "last_received": self.last_received, "queued_ticks": self.queue.qsize()},
            }

    def _rank(self, trades):
        books, combinations = defaultdict(list), defaultdict(list)
        for trade in trades:
            if not trade["exit_at"]:
                continue
            books[f'{trade["strategy"]} | {trade["symbol"]} | {trade["timeframe"]}m'].append(trade)
            combination = " + ".join(sorted(trade["tags"])) or "No confirming indicators"
            combinations[f'{combination} | {trade["symbol"]} | {trade["timeframe"]}m'].append(trade)
        def rows(groups):
            result = [{"name": key, **metrics(value)} for key, value in groups.items()]
            return sorted(result, key=lambda row: (row["expectancy"], row["win_rate"], row["closed"]), reverse=True)
        return {"strategies": rows(books), "combinations": rows(combinations),
                "note": "Descriptive, in-sample rankings; overlapping paper books are correlated. Small samples are not evidence of future profitability."}

    def events(self, trade_id):
        with self.connect() as db:
            return [dict(row) | {"payload": json.loads(row["payload"])} for row in db.execute(
                "SELECT at, kind, payload FROM events WHERE trade_id=? ORDER BY id", (trade_id,))]

    def chart_snapshot(self, symbol, timeframe, day=None):
        day = day or now_ist().date().isoformat()
        with self.connect() as db:
            trades = [json.loads(row["payload"]) for row in db.execute(
                "SELECT payload FROM trades WHERE symbol=? AND "
                "json_extract(payload, '$.timeframe')=? AND (day=? OR status='OPEN') "
                "ORDER BY (status='OPEN') DESC, rowid DESC LIMIT 30",
                (symbol, timeframe, day))]
            pending = [json.loads(row["payload"]) for row in db.execute(
                "SELECT payload FROM signals WHERE symbol=? AND timeframe=? AND day=? "
                "AND status='PENDING' ORDER BY rowid DESC", (symbol, timeframe, day))]
            pending = [signal for signal in pending if now_ist() < parse_time(signal["expires_at"])]
            quote_row = db.execute("SELECT payload FROM quotes WHERE symbol=?", (symbol,)).fetchone()
            return {
                "symbol": symbol, "timeframe": timeframe, "day": day, "trades": trades,
                "pending_count": len(pending),
                "quote": json.loads(quote_row["payload"]) if quote_row else None,
                "health": {"running": bool(self.task and not self.task.done()), "error": self.error},
            }

    def export_day(self, day=None):
        report = self.snapshot(day, limit=2**31 - 1)
        with self.connect() as db:
            report["events"] = [
                dict(row) | {"payload": json.loads(row["payload"])}
                for row in db.execute(
                    "SELECT events.trade_id, events.at, events.kind, events.payload FROM events "
                    "WHERE events.trade_id IN (SELECT id FROM trades WHERE day=? "
                    "UNION SELECT id FROM of_paper WHERE day=?) ORDER BY events.id",
                    (report["day"], report["day"]),
                )
            ]
        return report

    async def _scan_order_flow(self):
        from routers.order_flow import build_snapshot
        from services.order_flow_engine import order_flow_engine
        failures = []
        for symbol in SYMBOLS:
            try:
                snapshot = await build_snapshot(symbol, 5, token=order_flow_engine.current_token(symbol))
                await self.run(self.order_flow.observe, snapshot, now_ist().timestamp())
            except (ValueError, OSError, sqlite3.Error, RuntimeError) as exc:
                failures.append(f"{symbol}: {exc}")
                logger.exception("Confirmed order-flow paper scan failed for %s", symbol)
        self.order_flow.error = "; ".join(failures) or None

    def _drain(self, batch_size=500):
        with self.lock:
            if not self._retry_batch:
                while len(self._retry_batch) < batch_size:
                    try:
                        self._retry_batch.append(self.queue.get_nowait())
                    except queue.Empty:
                        break
            if not self._retry_batch:
                return
            # One transaction per batch; on failure the whole batch is retried in order.
            with self.connect(write=True) as db:
                for tick in self._retry_batch:
                    self._process_tick(db, *tick)
            self._retry_batch = []

    def _finalize(self, at):
        with self.connect(write=True) as db:
            for row in db.execute("SELECT id, payload FROM signals WHERE status='PENDING'").fetchall():
                if at >= parse_time(json.loads(row["payload"])["expires_at"]):
                    db.execute("UPDATE signals SET status='EXPIRED' WHERE id=?", (row["id"],))
            include_today = at.hour * 60 + at.minute >= 930
            days = [row[0] for row in db.execute(
                "SELECT day FROM trades WHERE day<? OR (day=? AND ?) UNION "
                "SELECT day FROM of_paper WHERE day<? OR (day=? AND ?)",
                (at.date().isoformat(), at.date().isoformat(), include_today,
                 at.date().isoformat(), at.date().isoformat(), include_today))]
            if at.weekday() < 5 and include_today and at.date().isoformat() not in days:
                days.append(at.date().isoformat())
            for day in days:
                trades = [json.loads(row[0]) for row in db.execute("SELECT payload FROM trades WHERE day=?", (day,))]
                flow = self.order_flow.snapshot(db, day, limit=0)
                report = {"day": day, "generated_at": at.isoformat(), "summary": metrics(trades),
                          "rankings": self._rank(trades),
                          "order_flow": {"counts": flow["counts"], "net_points": flow["net_points"]},
                          "final": all(t["exit_at"] for t in trades) and not flow["counts"].get("OPEN", 0)}
                db.execute("INSERT OR REPLACE INTO reports VALUES (?,?)", (day, json.dumps(report)))

    async def start(self):
        if self.task and not self.task.done():
            return
        await self.run(self._initialize)
        self.task = asyncio.create_task(self._run())
        self.flow_task = asyncio.create_task(self._run_order_flow())

    async def _run_order_flow(self):
        while True:
            await self._scan_order_flow()
            await asyncio.sleep(1)

    def _initialize(self):
        with self.lock:
            self._ensure_schema()

    async def _run(self):
        last_report = None
        while True:
            try:
                await self.run(self._drain)
                await self.run(self.order_flow.drain)
                minute = now_ist().isoformat()[:16]
                if minute != last_report:
                    await self.run(self._finalize, now_ist())
                    last_report = minute
            except (sqlite3.Error, ValueError, OSError) as exc:
                self.error = str(exc)
                logger.exception("Paper trading processing failed; inspect paper health before trusting results")
            await asyncio.sleep(0.2)

    async def stop(self):
        if self.flow_task:
            self.flow_task.cancel()
            try:
                await self.flow_task
            except asyncio.CancelledError:
                pass
            self.flow_task = None
        if self.task:
            self.task.cancel()
            try:
                await self.task
            except asyncio.CancelledError:
                pass
            self.task = None
        while self.order_flow.retry or not self.order_flow.queue.empty():
            await self.run(self.order_flow.drain)
        while self._retry_batch or not self.queue.empty():
            await self.run(self._drain)
        await self.run(self._finalize, now_ist())


_service = PaperTradingService()


def get_paper_trading_service():
    return _service

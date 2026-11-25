import logging
import json
import math
import os
import sqlite3
import threading
from contextlib import asynccontextmanager, closing
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from openingedge.ai import load_config, review
from openingedge.context import ContextFeed
from openingedge.execution import Execution
from openingedge.external import fetch_fred, fetch_marketaux, fred_key, marketaux_key

logger = logging.getLogger("openingedge")
IST = ZoneInfo("Asia/Kolkata")
INDICES = {"NIFTY": ("NSE", "NIFTY 50"), "BANKNIFTY": ("NSE", "NIFTY BANK"), "SENSEX": ("BSE", "SENSEX")}
ENV_FILE = Path(os.getenv("OPENINGEDGE_BACKEND_ENV_FILE", Path(__file__).resolve().parents[1] / "backend" / ".env"))
DB_PATH = Path(os.getenv("OPENINGEDGE_DB_PATH", Path(__file__).resolve().parent / "data" / "openingedge.sqlite3"))
FRESH_SECONDS = 10


def complete_preopen(samples, now):
    return bool(now.time() >= time(9, 8) and len(samples) >= 5
                and samples[0][0].time() <= time(9, 1)
                and samples[-1][0].time() >= time(9, 7)
                and all((b[0] - a[0]).total_seconds() <= 90 for a, b in zip(samples, samples[1:])))


def credentials():
    values = {}
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            name, sep, value = line.partition("=")
            if sep and name.strip() in {"ZERODHA_API_KEY", "ZERODHA_ACCESS_TOKEN"}:
                values[name.strip()] = value.strip().strip("\"'")
    except OSError as exc:
        logger.warning("Cannot read Zerodha environment file: %s", exc)
    return values.get("ZERODHA_API_KEY", ""), values.get("ZERODHA_ACCESS_TOKEN", "")


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = threading.RLock()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS index_config (symbol TEXT PRIMARY KEY, lots INTEGER NOT NULL, risk REAL)")
            db.execute("CREATE TABLE IF NOT EXISTS limits (id INTEGER PRIMARY KEY CHECK(id=1), daily_loss REAL)")
            db.execute("""CREATE TABLE IF NOT EXISTS ai_reviews (
                day TEXT NOT NULL, symbol TEXT NOT NULL, state TEXT NOT NULL,
                action TEXT, confidence REAL, reason TEXT NOT NULL,
                PRIMARY KEY(day, symbol))""")
            db.execute("""CREATE TABLE IF NOT EXISTS external_cues (
                name TEXT PRIMARY KEY, attempted_at TEXT NOT NULL, payload TEXT)""")
            db.execute("""CREATE TABLE IF NOT EXISTS last_market_cues (
                name TEXT PRIMARY KEY, observed_at TEXT NOT NULL, payload TEXT NOT NULL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS execution_trades (
                trade_id TEXT PRIMARY KEY, day TEXT NOT NULL, payload TEXT NOT NULL,
                net_pnl REAL, closed_at REAL)""")
            db.execute("""CREATE TABLE IF NOT EXISTS execution_runtime (
                id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT)""")
            db.executemany("INSERT OR IGNORE INTO index_config VALUES (?, 1, NULL)", [(symbol,) for symbol in INDICES])
            db.execute("INSERT OR IGNORE INTO limits VALUES (1, NULL)")
            db.execute("INSERT OR IGNORE INTO execution_runtime VALUES (1, NULL)")

    def read(self):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("SELECT symbol, lots, risk FROM index_config").fetchall()
            daily = db.execute("SELECT daily_loss FROM limits WHERE id=1").fetchone()
        return {"indices": {s: {"lots": lots, "risk": risk} for s, lots, risk in rows}, "daily_loss": daily[0]}

    def save_index(self, symbol, lots, risk):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE index_config SET lots=?, risk=? WHERE symbol=?", (lots, risk, symbol))

    def save_daily_loss(self, value):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE limits SET daily_loss=? WHERE id=1", (value,))

    def claim_review(self, day, symbol):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            cursor = db.execute(
                "INSERT OR IGNORE INTO ai_reviews VALUES (?, ?, 'PENDING', NULL, NULL, ?)",
                (day, symbol, "Review in progress or interrupted; no retry today."),
            )
            return cursor.rowcount == 1

    def finish_review(self, day, symbol, result):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE ai_reviews SET state=?, action=?, confidence=?, reason=? WHERE day=? AND symbol=?",
                       (result["state"], result["action"], result["confidence"], result["reason"], day, symbol))

    def reviews(self, day):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            rows = db.execute(
                "SELECT symbol, state, action, confidence, reason FROM ai_reviews WHERE day=?", (day,),
            ).fetchall()
        return {symbol: {"state": state, "action": action, "confidence": confidence, "reason": reason}
                for symbol, state, action, confidence, reason in rows}

    def claim_external(self, name, now, interval):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute("SELECT attempted_at, payload FROM external_cues WHERE name=?", (name,)).fetchone()
            if row and (now - datetime.fromisoformat(row[0])).total_seconds() < interval:
                return False
            if row and row[1]:
                retry_until = json.loads(row[1]).get("retry_until")
                if retry_until and now < datetime.fromisoformat(retry_until):
                    return False
            db.execute("""INSERT INTO external_cues (name, attempted_at, payload) VALUES (?, ?, NULL)
                          ON CONFLICT(name) DO UPDATE SET attempted_at=excluded.attempted_at""",
                       (name, now.isoformat()))
            return True

    def finish_external(self, name, payload):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            row = db.execute("SELECT payload FROM external_cues WHERE name=?", (name,)).fetchone()
            if payload["status"] == "UNAVAILABLE" and row and row[0]:
                previous = json.loads(row[0])
                if previous.get("status") == "LAST":
                    previous["refresh_error"] = payload["detail"]
                    if payload.get("retry_until"):
                        previous["retry_until"] = payload["retry_until"]
                    else:
                        previous.pop("retry_until", None)
                    payload = previous
            db.execute("UPDATE external_cues SET payload=? WHERE name=?", (json.dumps(payload), name))

    def external(self, name):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            row = db.execute("SELECT payload FROM external_cues WHERE name=?", (name,)).fetchone()
        return json.loads(row[0]) if row and row[0] else None

    def save_market_cues(self, cues, now):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            for name in ("auction_gap", "iv"):
                cue = cues.get(name)
                if not cue:
                    continue
                opening_gap = name == "auction_gap" and cue.get("kind") == "opening_gap"
                if cue["status"] not in ("FROZEN", "LIVE") and not (opening_gap and cue["status"] == "LAST"):
                    continue
                observed_at = cue.get("observed_at", now.isoformat())
                db.execute("""INSERT INTO last_market_cues VALUES (?, ?, ?)
                    ON CONFLICT(name) DO UPDATE SET observed_at=excluded.observed_at, payload=excluded.payload
                    WHERE excluded.observed_at > last_market_cues.observed_at""",
                    ("opening_gap" if opening_gap else name, observed_at, json.dumps(cue)))

    def last_market_cues(self):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            rows = db.execute("SELECT name, observed_at, payload FROM last_market_cues").fetchall()
        return {name: (datetime.fromisoformat(observed_at), json.loads(payload))
                for name, observed_at, payload in rows}

    def load_active_trade(self):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            try:
                row = db.execute("SELECT payload FROM execution_runtime WHERE id=1").fetchone()
            except sqlite3.OperationalError:
                return None
        if not row or not row[0]:
            return None
        active = json.loads(row[0])
        return active if active and active.get("state") not in ("CLOSED", "UNFILLED") else None

    def save_active_trade(self, trade):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE execution_runtime SET payload=? WHERE id=1",
                       (json.dumps(trade) if trade else None,))

    def record_execution_intent(self, trade):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("""INSERT OR IGNORE INTO execution_trades
                (trade_id, day, payload, net_pnl, closed_at) VALUES (?, ?, ?, NULL, NULL)""",
                       (trade["id"], trade["day"], json.dumps(trade)))

    def finish_active_trade(self, trade):
        with self.lock, closing(sqlite3.connect(self.path)) as db, db:
            db.execute("""UPDATE execution_trades SET payload=?, net_pnl=?, closed_at=?
                          WHERE trade_id=?""",
                       (json.dumps(trade), trade.get("net_pnl"), trade.get("closed_at"), trade["id"]))

    def has_entry_today(self, day):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            return db.execute("SELECT 1 FROM execution_trades WHERE day=? LIMIT 1", (day,)).fetchone() is not None

    def today_realized_pnl(self, day):
        with self.lock, closing(sqlite3.connect(self.path)) as db:
            rows = db.execute(
                "SELECT COALESCE(net_pnl, 0) FROM execution_trades WHERE day=?", (day,)).fetchall()
        return sum(float(row[0]) for row in rows)


class Market:
    def __init__(self, clock=None):
        self.clock = clock or (lambda: datetime.now(IST))
        self.lock = threading.RLock()
        self.day = None
        self.tokens = {}
        self.quotes = {}
        self.last_quotes = {}
        self.previous_sessions = {}
        self.last_open_gap = None
        self.preopen = {symbol: [] for symbol in INDICES}
        self.state = "starting"
        self.error = "Connecting to the independent Zerodha feed."
        self.feed_enabled = True
        self.snapshot_error = None
        self.context = ContextFeed()

    def set_feed_enabled(self, enabled):
        with self.lock:
            if self.feed_enabled != enabled:
                self.feed_enabled = enabled
                self.state = "starting" if enabled else "stopping"
                self.error = "Connecting to the independent Zerodha feed." if enabled else "Stopping the independent Zerodha feed."
                self.quotes = {}
                self.preopen = {symbol: [] for symbol in INDICES}
                with self.context.lock:
                    self.context.quotes.clear()

    def instruments(self, rows):
        found = {}
        for row in rows:
            for name, identity in INDICES.items():
                if (row.get("exchange"), row.get("tradingsymbol")) == identity and row.get("instrument_token"):
                    found[row["instrument_token"]] = name
        with self.lock:
            self.tokens = found
        return list(found)

    def set_history(self, symbol, candles):
        today = self.clock().date()
        valid = []
        for candle in candles:
            stamp = candle.get("date")
            if not isinstance(stamp, datetime):
                continue
            day = stamp.astimezone(IST).date() if stamp.tzinfo else stamp.date()
            values = [candle.get(key) for key in ("high", "low", "close")]
            if (not today - timedelta(days=5) <= day < today
                    or any(isinstance(v, bool) or not isinstance(v, (int, float))
                           or not math.isfinite(v) or v <= 0 for v in values)):
                continue
            high, low, close = values
            if not low <= close <= high:
                continue
            open_price = candle.get("open")
            if (isinstance(open_price, bool) or not isinstance(open_price, (int, float))
                    or not math.isfinite(open_price) or not low <= open_price <= high):
                open_price = None
            valid.append((day, {"day": day.isoformat(), "high": high, "low": low,
                                "close": close, "open": open_price}))
        with self.lock:
            latest = max(valid, key=lambda row: row[0])[1] if valid else None
            self.previous_sessions[symbol] = (
                {key: latest[key] for key in ("day", "high", "low", "close")} if latest else None)
            if symbol == "NIFTY":
                sessions = sorted(valid, key=lambda row: row[0])
                self.last_open_gap = None
                if len(sessions) >= 2 and sessions[-1][1]["open"]:
                    day, current = sessions[-1]
                    previous_day, previous = sessions[-2]
                    self.last_open_gap = {
                        "status": "LAST", "value": (current["open"] / previous["close"] - 1) * 100,
                        "change_percent": None, "observed_at": datetime.combine(day, time(9, 15), tzinfo=IST).isoformat(),
                        "kind": "opening_gap",
                        "detail": f"Last session opening gap ({day}): Zerodha NIFTY daily open {current['open']} "
                                  f"versus {previous_day} close {previous['close']}. This is the opening gap, "
                                  "not a recorded pre-open tick.",
                    }

    def set_last_quotes(self, quotes):
        now = self.clock()
        with self.lock:
            for token, tick in quotes.items():
                symbol = self.tokens.get(token)
                stamp, price = tick.get("timestamp"), tick.get("last_price")
                if not symbol or not isinstance(stamp, datetime) or isinstance(price, bool) or not isinstance(price, (int, float)):
                    continue
                stamp = stamp.replace(tzinfo=IST) if stamp.tzinfo is None else stamp.astimezone(IST)
                if not math.isfinite(price) or price <= 0 or not 0 <= (now - stamp).total_seconds() <= 7 * 86400:
                    continue
                previous = (tick.get("ohlc") or {}).get("close")
                if isinstance(previous, bool) or not isinstance(previous, (int, float)) or not math.isfinite(previous) or previous <= 0:
                    previous = None
                old = self.last_quotes.get(symbol)
                if not old or stamp >= old["timestamp"]:
                    self.last_quotes[symbol] = {"price": price, "previous_close": previous, "timestamp": stamp}

    def setup_evidence(self, symbol):
        now = self.clock()
        if now.weekday() >= 5 or not time(9, 15) <= now.time() < time(15, 30):
            return None
        with self.lock:
            samples = sorted(self.preopen[symbol]) if self.day == now.date() else []
            prior = self.previous_sessions.get(symbol)
            quote = self.quotes.get(symbol) if self.day == now.date() else None
            if (not self.feed_enabled or self.state != "connected"
                    or not complete_preopen(samples, now) or not prior or not quote):
                return None
            prior_date = datetime.fromisoformat(prior["day"]).date()
            if not now.date() - timedelta(days=5) <= prior_date < now.date():
                return None
            age = (now - quote["timestamp"]).total_seconds()
            previous_close = quote["previous_close"]
            if (not -3 <= age <= FRESH_SECONDS or previous_close is None
                    or not math.isfinite(previous_close) or previous_close <= 0):
                return None
            first, last = samples[0][1], samples[-1][1]
            close = prior["close"]
            direction = "BUY_CE" if last > first and last > close else (
                "BUY_PE" if last < first and last < close else None)
            preopen_high = max(price for _, price in samples)
            preopen_low = min(price for _, price in samples)
            breakout = (
                direction == "BUY_CE" and quote["price"] > preopen_high and quote["price"] > previous_close
            ) or (
                direction == "BUY_PE" and quote["price"] < preopen_low and quote["price"] < previous_close
            )
            if not breakout:
                return None
            return {
                "index": symbol, "setup": "PREOPEN_RANGE_BREAKOUT", "direction": direction,
                "live_price": quote["price"], "live_timestamp": quote["timestamp"].isoformat(),
                "live_previous_close": previous_close,
                "preopen_first": first, "preopen_last": last,
                "preopen_high": preopen_high, "preopen_low": preopen_low,
                "sample_count": len(samples), "previous_session": dict(prior),
            }

    def on_ticks(self, ticks):
        now = self.clock()
        with self.lock:
            if not self.feed_enabled:
                return
            self.context.on_ticks(ticks, now, IST)
            if self.day != now.date():
                self.day = now.date()
                self.quotes = {}
                self.preopen = {symbol: [] for symbol in INDICES}
            for tick in ticks:
                symbol = self.tokens.get(tick.get("instrument_token"))
                stamp = tick.get("exchange_timestamp") or tick.get("timestamp")
                raw = tick.get("last_price")
                if not symbol or not isinstance(stamp, datetime) or isinstance(raw, bool) or not isinstance(raw, (int, float)):
                    continue
                stamp = stamp.astimezone(IST)
                price = float(raw)
                if not math.isfinite(price) or price <= 0 or stamp.date() != now.date():
                    continue
                if not -3 <= (now - stamp).total_seconds() <= FRESH_SECONDS:
                    continue
                previous = tick.get("ohlc", {}).get("close")
                if isinstance(previous, bool) or not isinstance(previous, (int, float)) or not math.isfinite(previous) or previous <= 0:
                    previous = None
                self.quotes[symbol] = {"price": price, "previous_close": previous, "timestamp": stamp}
                if time(9, 0) <= stamp.time() < time(9, 8):
                    self.preopen[symbol].append((stamp, price))

    def status(self):
        now = self.clock()
        t = now.time()
        stage = "PRE-OPEN INTELLIGENCE" if time(9, 0) <= t < time(9, 8) else (
            "FREEZE & VALIDATE" if time(9, 8) <= t < time(9, 15) else (
                "EXECUTION WINDOW" if time(9, 15) <= t < time(9, 20) else (
                    "ENTRY LOCK" if t >= time(9, 20) else "WAITING FOR 09:00")))
        with self.lock:
            quotes = {}
            for name in INDICES:
                q = self.quotes.get(name) if self.day == now.date() else None
                fresh = q and self.feed_enabled and self.state == "connected" and -3 <= (now - q["timestamp"]).total_seconds() <= FRESH_SECONDS
                last = self.last_quotes.get(name)
                if not fresh and last and 0 <= (now - last["timestamp"]).total_seconds() <= 7 * 86400:
                    q = last
                elif not fresh:
                    q = None
                samples = sorted(self.preopen[name]) if self.day == now.date() else []
                prev = q["previous_close"] if q else None
                change = q["price"] - prev if prev else None
                quotes[name] = {
                    "price": q["price"] if q else None,
                    "change": change,
                    "change_percent": change / prev * 100 if prev else None,
                    "timestamp": q["timestamp"].isoformat() if q else None,
                    "source_status": "LIVE" if fresh else "LAST" if q else "UNAVAILABLE",
                    "preopen_complete": complete_preopen(samples, now),
                    "preopen_high": max((p for _, p in samples), default=None),
                    "preopen_low": min((p for _, p in samples), default=None),
                }
            samples = sorted(self.preopen["NIFTY"]) if self.day == now.date() else []
            prior = self.previous_sessions.get("NIFTY")
            if prior and now.date() - timedelta(days=5) <= datetime.fromisoformat(prior["day"]).date() < now.date():
                prior = {**prior, "current_day": now.date().isoformat()}
            else:
                prior = None
            context = self.context.snapshot(
                now, self.feed_enabled and self.state == "connected",
                quotes["NIFTY"]["price"] if quotes["NIFTY"]["source_status"] == "LIVE" else None,
                samples[-1][1] if complete_preopen(samples, now) else None, prior,
            )
            if context["auction_gap"]["status"] == "FROZEN":
                context["auction_gap"]["observed_at"] = samples[-1][0].isoformat()
                context["auction_gap"]["detail"] += f" Last pre-open tick: {samples[-1][0].isoformat()}."
            elif self.last_open_gap:
                context["auction_gap"] = dict(self.last_open_gap)
                if (now - datetime.fromisoformat(self.last_open_gap["observed_at"])).total_seconds() > 7 * 86400:
                    context["auction_gap"]["status"] = "STALE"
            for name, cue in self.context.last_snapshot(now).items():
                if context[name]["status"] == "UNAVAILABLE":
                    context[name] = cue
            state = self.state if self.feed_enabled or self.state == "off" else "stopping"
            error = self.error if self.feed_enabled or self.state == "off" else "Stopping the independent Zerodha feed."
            return {"stage": stage, "feed_enabled": self.feed_enabled,
                    "feed_status": state, "feed_error": error, "indices": quotes,
                    "context": context, "snapshot_error": self.snapshot_error}


store = Store(DB_PATH)
market = Market()
shutdown = threading.Event()
execution = None


def get_execution():
    global execution
    if execution is None:
        execution = Execution(store, market, ENV_FILE)
    return execution


def load_history(kite, tokens):
    now = market.clock()
    for token, symbol in tokens.items():
        try:
            candles = kite.historical_data(token, now - timedelta(days=10), now, "day")
            market.set_history(symbol, candles)
        except Exception:
            logger.exception("Unable to load previous session for %s", symbol)
            with market.lock:
                market.previous_sessions[symbol] = None


def load_snapshots(kite):
    with market.lock:
        indices = {f"{exchange}:{name}": token for token, symbol in market.tokens.items()
                   for index, (exchange, name) in INDICES.items() if symbol == index}
    with market.context.lock:
        instruments = {
            f"{data['exchange']}:{data['symbol']}": token
            for token, data in market.context.instruments.items()
        }
    keys = {**indices, **instruments}
    response = kite.quote(list(keys))
    quotes = {token: response[name] for name, token in keys.items()
              if name in response and response[name].get("instrument_token") == token}
    if not quotes:
        raise ValueError("Zerodha returned no matching quote snapshots")
    market.set_last_quotes(quotes)
    with market.lock:
        spot = market.last_quotes.get("NIFTY")
    now = market.clock()
    usable_spot = spot and 0 <= (now - spot["timestamp"]).total_seconds() <= 7 * 86400
    selected = market.context.select_options(spot["price"] if usable_spot else None, now)
    with market.context.lock:
        options = {f"NFO:{market.context.options[token]['tradingsymbol']}": token for token in selected}
    if options:
        option_response = kite.quote(list(options))
        quotes.update({token: option_response[name] for name, token in options.items()
                       if name in option_response and option_response[name].get("instrument_token") == token})
    market.context.set_last_quotes(quotes, selected, market.clock(), IST)


def run_external():
    while not shutdown.is_set():
        key, _ = fred_key(ENV_FILE)
        if key:
            try:
                if store.claim_external("us_vix", datetime.now(timezone.utc), 6 * 3600):
                    result = fetch_fred(key)
                    if result["status"] == "UNAVAILABLE":
                        logger.warning("%s", result["detail"])
                    store.finish_external("us_vix", result)
            except sqlite3.Error:
                logger.exception("FRED cue journal unavailable")
        key, _ = marketaux_key(ENV_FILE)
        if key:
            try:
                if store.claim_external("news", datetime.now(timezone.utc), 3600):
                    result = fetch_marketaux(key)
                    if result["status"] == "UNAVAILABLE":
                        logger.warning("%s", result["detail"])
                    store.finish_external("news", result)
            except sqlite3.Error:
                logger.exception("Marketaux cue journal unavailable")
        shutdown.wait(30)


def run_reviews():
    while not shutdown.is_set():
        now = market.clock()
        if now.weekday() < 5 and time(9, 15) <= now.time() < time(15, 30):
            try:
                config, _ = load_config(ENV_FILE)
                if config:
                    for symbol in INDICES:
                        now = market.clock()
                        if now.weekday() >= 5 or not time(9, 15) <= now.time() < time(15, 30):
                            break
                        evidence = market.setup_evidence(symbol)
                        if evidence is None:
                            continue
                        day = now.date().isoformat()
                        if not store.claim_review(day, symbol):
                            continue
                        now = market.clock()
                        evidence = market.setup_evidence(symbol) if now.date().isoformat() == day else None
                        if evidence is None:
                            store.finish_review(day, symbol, {
                                "state": "UNAVAILABLE", "action": None, "confidence": None,
                                "reason": "Breakout or required live market data expired before review.",
                            })
                            continue
                        result = review(config, evidence)
                        store.finish_review(day, symbol, result)
            except sqlite3.Error:
                logger.exception("Haiku review journal unavailable")
        shutdown.wait(5)


def run_feed():
    try:
        from kiteconnect import KiteConnect, KiteTicker
        from twisted.internet import reactor
    except ImportError:
        market.state, market.error = "error", "kiteconnect is not installed."
        return
    socket = None
    used_credentials = None
    history_day = None
    kite = None
    selected_options = set()
    refreshed_day = None
    context_retry_at = None
    context_static = set()
    context_segments = {name: [] for name in ("NFO", "BFO", "CDS", "NSEIX", "GLOBAL", "MCX")}
    nse_rows = []
    snapshot_at = None
    cue_save_at = None

    def close_socket(ws):
        if reactor.running:
            reactor.callFromThread(ws.close)
        else:
            ws.close()

    def connect_socket(ws):
        with market.lock:
            if ws is socket and market.feed_enabled:
                ws.connect(threaded=True)

    while not shutdown.is_set():
        with market.lock:
            enabled = market.feed_enabled
        if not enabled:
            if socket:
                old_socket, socket = socket, None
                close_socket(old_socket)
            used_credentials = None
            kite = None
            history_day = None
            with market.lock:
                if not market.feed_enabled:
                    market.state, market.error = "off", "Independent Zerodha feed is switched off."
                    get_execution().set_broker(None)
            shutdown.wait(1)
            continue
        now = market.clock()
        if socket and now.time() >= time(8, 30) and refreshed_day != now.date():
            market.state = "disconnected"
        current = credentials()
        if not all(current):
            if socket:
                close_socket(socket)
                socket = None
            used_credentials = None
            kite = None
            history_day = None
            market.state, market.error = "error", "Zerodha key or access token unavailable in backend/.env."
        elif current != used_credentials or market.state in {"starting", "error", "disconnected"}:
            if socket:
                close_socket(socket)
                socket = None
            used_credentials = current
            market.state, market.error = "connecting", None
            try:
                kite = KiteConnect(api_key=current[0])
                kite.set_access_token(current[1])
                get_execution().set_broker(kite)
                nse_rows = kite.instruments("NSE")
                rows = nse_rows + kite.instruments("BSE")
                tokens = market.instruments(rows)
                if len(tokens) != len(INDICES):
                    raise ValueError("Not all index instruments were found")
                context_segments = {name: [] for name in context_segments}
                for segment in context_segments:
                    try:
                        context_segments[segment] = kite.instruments(segment)
                    except Exception:
                        logger.exception("OpeningEdge %s context instruments unavailable", segment)
                context_static = set(market.context.configure(
                    nse_rows, context_segments["NFO"], context_segments["CDS"], now,
                    international=context_segments["NSEIX"] + context_segments["GLOBAL"],
                    commodities=context_segments["MCX"],
                    bfo=context_segments["BFO"],
                ))
                tokens += list(context_static)
                context_retry_at = now + timedelta(minutes=5)
                snapshot_at = None
                selected_options = set()
                if now.time() >= time(8, 30):
                    refreshed_day = now.date()
                socket = KiteTicker(*current)
                def connected(ws, response):
                    with market.lock:
                        if ws is not socket or not market.feed_enabled:
                            return
                        ws.subscribe(tokens)
                        ws.set_mode(KiteTicker.MODE_FULL, tokens)
                        market.state, market.error = "connected", None
                def closed(ws, code, reason):
                    with market.lock:
                        if ws is socket and market.feed_enabled:
                            market.state, market.error = "disconnected", f"Zerodha feed closed ({code})."
                def failed(ws, code, reason):
                    with market.lock:
                        if ws is socket and market.feed_enabled:
                            market.state, market.error = "error", f"Zerodha feed error ({code})."
                socket.on_connect = connected
                socket.on_ticks = lambda ws, ticks: market.on_ticks(ticks) if ws is socket and market.feed_enabled else None
                socket.on_close = closed
                socket.on_error = failed
                if reactor.running:
                    reactor.callFromThread(connect_socket, socket)
                else:
                    connect_socket(socket)
                history_day = None
            except Exception:
                logger.exception("Independent Zerodha feed failed")
                market.state, market.error = "error", "Zerodha feed initialization failed; check service logs."
        if not market.feed_enabled:
            continue
        if kite and market.state == "connected" and history_day != market.clock().date():
            history_day = market.clock().date()
            with market.lock:
                tokens_by_symbol = dict(market.tokens)
            threading.Thread(target=load_history, args=(kite, tokens_by_symbol), daemon=True,
                             name="openingedge-history").start()
        if market.feed_enabled and kite and socket and (snapshot_at is None or market.clock() >= snapshot_at):
            snapshot_at = market.clock() + timedelta(minutes=5)
            try:
                load_snapshots(kite)
                market.snapshot_error = None
            except Exception:
                logger.exception("OpeningEdge last quote snapshot unavailable")
                market.snapshot_error = "Zerodha last-quote snapshot unavailable; check service logs."
        if market.feed_enabled and socket and market.state == "connected":
            now = market.clock()
            if context_retry_at and now >= context_retry_at and any(not rows for rows in context_segments.values()):
                context_retry_at = now + timedelta(minutes=5)
                available_before = {name for name, rows in context_segments.items() if rows}
                for segment, rows in context_segments.items():
                    if rows:
                        continue
                    try:
                        context_segments[segment] = kite.instruments(segment)
                    except Exception:
                        logger.exception("OpeningEdge %s context instrument retry failed", segment)
                if {name for name, rows in context_segments.items() if rows} != available_before:
                    try:
                        updated_static = set(market.context.configure(
                            nse_rows, context_segments["NFO"], context_segments["CDS"], now,
                            international=context_segments["NSEIX"] + context_segments["GLOBAL"],
                            commodities=context_segments["MCX"],
                            bfo=context_segments["BFO"],
                        ))
                        removed = (context_static - updated_static) | selected_options
                        added = updated_static - context_static
                        if removed:
                            socket.unsubscribe(list(removed))
                        if added:
                            socket.subscribe(list(added))
                            socket.set_mode(KiteTicker.MODE_FULL, list(added))
                        context_static, selected_options = updated_static, set()
                        snapshot_at = None
                    except Exception:
                        logger.exception("OpeningEdge context resubscription failed")
                        market.state, market.error = "error", "Context subscription failed; reconnecting feed."
                        shutdown.wait(5)
                        continue
            state = market.status()
            if cue_save_at is None or now >= cue_save_at:
                cue_save_at = now + timedelta(seconds=30)
                try:
                    store.save_market_cues(state["context"], now)
                except sqlite3.Error:
                    logger.exception("OpeningEdge last market cue journal unavailable")
            spot = state["indices"]["NIFTY"]["price"]
            desired = market.context.select_options(spot, market.clock())
            if desired != selected_options:
                try:
                    market.context.set_selected(desired)
                    if selected_options - desired:
                        socket.unsubscribe(list(selected_options - desired))
                    if desired - selected_options:
                        socket.subscribe(list(desired - selected_options))
                        socket.set_mode(KiteTicker.MODE_FULL, list(desired - selected_options))
                    selected_options = desired
                except Exception:
                    logger.exception("OpeningEdge option subscriptions failed")
                    market.state, market.error = "error", "Option subscription failed; reconnecting feed."
        if market.feed_enabled and kite and market.state == "connected":
            get_execution().tick()
        shutdown.wait(5)
    if socket:
        close_socket(socket)


@asynccontextmanager
async def lifespan(app):
    store.initialize()
    global execution
    execution = Execution(store, market, ENV_FILE)
    shutdown.clear()
    worker = threading.Thread(target=run_feed, daemon=True, name="openingedge-feed")
    worker.start()
    threading.Thread(target=run_reviews, daemon=True, name="openingedge-ai").start()
    threading.Thread(target=run_external, daemon=True, name="openingedge-external").start()
    try:
        yield
    finally:
        shutdown.set()


app = FastAPI(title="Independent OpeningEdge", lifespan=lifespan)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/api/status")
def status():
    try:
        config = store.read()
        reviews = store.reviews(market.clock().date().isoformat())
    except sqlite3.Error as exc:
        logger.exception("OpeningEdge configuration unavailable")
        raise HTTPException(503, "Configuration store unavailable") from exc
    ai_config, ai_error = load_config(ENV_FILE)
    market_status = market.status()
    key, key_error = fred_key(ENV_FILE)
    news_key, news_key_error = marketaux_key(ENV_FILE)
    try:
        cue = store.external("us_vix")
        news = store.external("news")
        saved_cues = store.last_market_cues()
    except sqlite3.Error as exc:
        logger.exception("OpeningEdge cue journal unavailable")
        raise HTTPException(503, "Cue store unavailable") from exc
    if cue and cue.get("source_date"):
        age = (datetime.now(timezone.utc).date() - datetime.fromisoformat(cue["source_date"]).date()).days
        if age > 14 or age < 0:
            cue["status"] = "STALE"
            cue["detail"] += " The observation is more than 14 days old or dated in the future."
        if cue.get("refresh_error"):
            cue["detail"] = cue["refresh_error"] + " " + cue["detail"]
        if not key:
            cue["detail"] += " FRED key unavailable; this saved value cannot be refreshed."
    market_status["context"]["us_vix"] = cue or {
        "status": "UNAVAILABLE", "value": None, "change_percent": None,
        "detail": (key_error or "Set OPENINGEDGE_FRED_API_KEY to retrieve the daily US VIX close.")
                  if not key else "Waiting for FRED's daily VIX close.",
    }
    if news and news.get("source_at"):
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(news["source_at"])).total_seconds()
        if age > 48 * 3600 or age < 0:
            news["status"] = "STALE"
            news["detail"] += " The oldest article is more than 48 hours old or dated in the future."
        if news.get("refresh_error"):
            news["detail"] = news["refresh_error"] + " " + news["detail"]
        if not news_key:
            news["detail"] += " Marketaux token unavailable; this saved value cannot be refreshed."
    market_status["context"]["news"] = news or {
        "status": "UNAVAILABLE", "value": None, "change_percent": None,
        "detail": (news_key_error or "Set OPENINGEDGE_MARKETAUX_API_TOKEN for India-related news tone.")
                  if not news_key else "Waiting for Marketaux news.",
    }
    now = market.clock()
    for saved_name in ("opening_gap", "auction_gap", "iv"):
        if saved_name not in saved_cues:
            continue
        observed, saved = saved_cues[saved_name]
        name = "auction_gap" if saved_name == "opening_gap" else saved_name
        current = market_status["context"].get(name)
        if not current or current["status"] in ("LIVE", "FROZEN"):
            continue
        if (current.get("observed_at") and
                datetime.fromisoformat(current["observed_at"]).date() > observed.date()):
            continue
        age = (now - observed).total_seconds()
        saved["status"] = "LAST" if 0 <= age <= 7 * 86400 else "STALE"
        saved["detail"] += f" Saved observation time: {observed.isoformat()}; not live."
        market_status["context"][name] = saved
    controller = get_execution().status()
    return {
        **market_status, "config": config, "reviews": reviews,
        "ai_status": "READY" if ai_config else "UNAVAILABLE", "ai_error": ai_error,
        **controller,
        "reason": controller["execution_error"] or controller["execution_block_reason"] or (
            (controller["active"] or {}).get("error")
        ) or (
            "OpeningEdge live entries are OFF; owned positions remain protected."
            if controller["trade_enabled"] else
            "Live execution is locked by LIVE_TRADE_ENABLED."
        ),
    }


class IndexConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    lots: int = Field(ge=1, le=100, strict=True)
    risk: float = Field(gt=0, le=10000000, allow_inf_nan=False, strict=True)


class DailyLimit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    daily_loss: float = Field(gt=0, le=10000000, allow_inf_nan=False, strict=True)


class FeedControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)


class TradeControl(BaseModel):
    model_config = ConfigDict(extra="forbid")
    enabled: bool = Field(strict=True)
    confirmation: str


@app.put("/api/feed-control")
def feed_control(config: FeedControl):
    market.set_feed_enabled(config.enabled)
    with market.lock:
        return {"feed_enabled": market.feed_enabled, "feed_status": market.state}


@app.put("/api/trade-control")
def trade_control(config: TradeControl):
    expected = ("START OPENINGEDGE LIVE TRADING" if config.enabled
                else "STOP OPENINGEDGE NEW ENTRIES")
    if config.confirmation != expected:
        raise HTTPException(422, "Trade control confirmation does not match the requested state")
    try:
        return get_execution().set_automation(config.enabled)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.put("/api/config/{symbol}")
def save_index(symbol: str, config: IndexConfig):
    if symbol not in INDICES:
        raise HTTPException(404, "Unknown index")
    try:
        store.save_index(symbol, config.lots, config.risk)
        return store.read()
    except sqlite3.Error as exc:
        logger.exception("Failed to save OpeningEdge index configuration")
        raise HTTPException(503, "Unable to save configuration") from exc


@app.put("/api/daily-limit")
def save_limit(config: DailyLimit):
    try:
        store.save_daily_loss(config.daily_loss)
        return store.read()
    except sqlite3.Error as exc:
        logger.exception("Failed to save OpeningEdge daily limit")
        raise HTTPException(503, "Unable to save daily limit") from exc

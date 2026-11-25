from __future__ import annotations

import json
import logging
import os
import queue
import threading
from copy import deepcopy
from datetime import datetime, time, timedelta
from math import isfinite
from pathlib import Path
from time import monotonic
from typing import Literal

import httpx
from kiteconnect import KiteConnect, KiteTicker
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from requests.exceptions import ConnectionError as RequestsConnectionError, Timeout as RequestsTimeout

from .config import IndexRisk, anthropic_key, credentials
from .engine import Candle, IST, SYMBOLS, aggregate, bucket, evaluate, session_open
from .execution import Blocked, Executor, quote_prices
from .store import Store

logger = logging.getLogger("smcapex")
SPOTS = {"NIFTY": ("NSE", "NIFTY 50"), "BANKNIFTY": ("NSE", "NIFTY BANK"),
         "SENSEX": ("BSE", "SENSEX")}


class Verdict(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approved: StrictBool
    setup_id: str
    side: Literal["CE", "PE"]
    contract: str
    reason: str


class PreopenAssessment(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bias: Literal["CE", "PE", "NEUTRAL"]
    summary: str = Field(min_length=1, max_length=600)
    risk_flags: list[str] = Field(max_length=5)


class Runtime:
    def __init__(self, path: str | None = None):
        self.lock = threading.RLock()
        self.store = Store(path or os.getenv("SMCAPEX_DB_PATH", str(Path(__file__).parent / "data" / "apex.sqlite3")))
        self.executor = Executor(self.store)
        self.configured_indices = {symbol for symbol in SYMBOLS if self.store.get(symbol)}
        self.daily_configured = bool(self.store.get("daily"))
        self.socket = None
        self.kite = None
        self.tokens: dict[int, tuple[str, str]] = {}
        self.catalog: list[dict] = []
        self.ticks: dict[tuple[str, str], dict] = {}
        self.tick_errors: dict[tuple[str, str], str] = {}
        self.candle_errors: dict[str, set[datetime]] = {}
        self.building: dict[str, dict] = {}
        self.signals: dict[str, dict] = {}
        self.error: str | None = None
        self.connection_lock = threading.Lock()
        self.connection_errors: dict[str, str] = {}
        self.feed = "CONNECTING"
        self.feed_connected_at = 0.0
        self.events: queue.Queue = queue.Queue(maxsize=10000)
        self.overflow = threading.Event()
        self.stop_event = threading.Event()
        self.worker = None
        self.current_credentials = None
        self.next_connection = 0.0
        self.retry_seconds = 60
        self.last_history = 0.0
        self.last_analysis = None
        self.last_day = None
        self.last_close_refresh = None
        self.history_loaded = False

    def start(self):
        self.worker = threading.Thread(target=self.run, name="smcapex-worker", daemon=True)
        self.worker.start()

    def stop(self):
        self.executor.enabled = False
        self.stop_event.set()
        if self.socket:
            self.socket.close()
        if self.worker:
            self.worker.join(timeout=15)
        # DB remains open if a blocked I/O worker has not yet exited.
        if not self.worker or not self.worker.is_alive():
            self.store.db.close()

    def fail(self, reason: str):
        logger.error("SMC Apex: %s", reason)
        self.error = reason
        self.executor.enabled = False

    def connection_failure(self, stage: str, reason: str):
        with self.connection_lock:
            if self.connection_errors.get(stage) != reason:
                logger.warning("SMC Apex: %s", reason)
            self.connection_errors[stage] = reason
        self.executor.enabled = False

    def connection_recovered(self, stage: str):
        with self.connection_lock:
            self.connection_errors.pop(stage, None)

    def connection_warnings(self) -> list[str]:
        with self.connection_lock:
            return list(self.connection_errors.values())

    def connect(self, cfg: dict):
        key, token = cfg["ZERODHA_API_KEY"], cfg["ZERODHA_ACCESS_TOKEN"]
        if not key or not token:
            raise Blocked("Zerodha API key/access token missing")
        self.executor.disable()
        if self.socket:
            self.socket.close()
        self.feed = "CONNECTING"
        self.ticks.clear()
        self.tick_errors.clear()
        self.building.clear()
        self.history_loaded = False
        kite = KiteConnect(api_key=key, timeout=8)
        kite.set_access_token(token)
        catalog = []
        for exchange in ("NSE", "BSE", "NFO", "BFO"):
            catalog.extend(kite.instruments(exchange))
            if self.stop_event.wait(.4):
                return
        tokens = {}
        for symbol in SYMBOLS:
            exchange, name = SPOTS[symbol]
            spot = next((r for r in catalog if r["exchange"] == exchange and r["tradingsymbol"] == name), None)
            if spot:
                tokens[int(spot["instrument_token"])] = (symbol, "spot")
            futures = [r for r in catalog if r.get("name") == symbol and r.get("instrument_type") == "FUT"
                       and r.get("expiry") and r["expiry"] >= datetime.now(IST).date()]
            if futures:
                future = min(futures, key=lambda r: r["expiry"])
                tokens[int(future["instrument_token"])] = (symbol, "future")
        if not tokens:
            raise Blocked("No index instruments resolved from Zerodha")
        socket = KiteTicker(key, token)
        self.socket = socket
        self.kite = self.executor.broker = kite
        self.catalog, self.tokens = catalog, tokens

        def on_ticks(ws, ticks):
            if ws is not self.socket or self.stop_event.is_set():
                return
            try:
                self.events.put_nowait((datetime.now(IST), ticks))
            except queue.Full:
                self.overflow.set()

        def on_connect(ws, response):
            if ws is not self.socket:
                return
            requested = list(tokens) + [int(t["token"]) for t in self.executor.active()]
            ws.subscribe(requested)
            ws.set_mode(KiteTicker.MODE_FULL, requested)
            self.feed = "CONNECTED"
            self.feed_connected_at = monotonic()
            self.connection_recovered("feed")

        def disconnected(ws, code, reason):
            if ws is self.socket:
                self.feed = "DISCONNECTED"
                self.connection_failure("feed", f"Zerodha feed disconnected (code {code}); reconnecting. New entries disabled.")

        socket.on_ticks = on_ticks
        socket.on_connect = on_connect
        socket.on_close = socket.on_error = disconnected
        socket.connect(threaded=True)
        self.current_credentials = (key, token)
        self.last_history = 0

    def stale_feed_streams(self, now: datetime) -> list[str]:
        if self.feed != "CONNECTED" or monotonic() - self.feed_connected_at < 15:
            return []
        stale = []
        for symbol in SYMBOLS:
            for kind in ("spot", "future"):
                tick = self.ticks.get((symbol, kind))
                if tick is None or (now - tick["received"]).total_seconds() > 10:
                    stale.append(f"{symbol} {kind}")
        return stale

    def history(self, now: datetime):
        if self.kite is None:
            return
        after_close = now.time() >= time(15, 31)
        for token, (symbol, kind) in self.tokens.items():
            if kind != "spot":
                continue
            days = 30 if not self.history_loaded else 1
            rows = self.kite.historical_data(token, now - timedelta(days=days), now, "minute")
            candles = []
            for row in rows:
                at = row["date"].astimezone(IST)
                if at + timedelta(minutes=1) > now or not session_open(at):
                    continue
                candles.append(Candle(at, float(row["open"]), float(row["high"]), float(row["low"]),
                                      float(row["close"]), float(row.get("volume") or 0)))
            with self.lock:
                self.store.candles(symbol, "1", candles)
                missing = self.candle_errors.get(symbol)
                if missing:
                    missing.difference_update(candle.at for candle in candles)
                    if not missing:
                        del self.candle_errors[symbol]
            if self.stop_event.wait(.4):
                return
            if not self.history_loaded or self.last_day != now.date() or (
                    after_close and self.last_close_refresh != now.date()):
                rows = self.kite.historical_data(token, now - timedelta(days=365), now, "day")
                daily = [Candle(r["date"].astimezone(IST), float(r["open"]), float(r["high"]),
                                float(r["low"]), float(r["close"]), float(r.get("volume") or 0))
                         for r in rows if r["date"].astimezone(IST).date() < now.date() or (
                             after_close and r["date"].astimezone(IST).date() == now.date())]
                with self.lock:
                    self.store.candles(symbol, "D", daily)
                if self.stop_event.wait(.4):
                    return
        self.history_loaded = True
        self.last_day = now.date()
        if after_close:
            self.last_close_refresh = now.date()
        self.last_history = monotonic()

    def reject_tick(self, resolved: tuple[str, str], reason: str):
        if self.tick_errors.get(resolved) != reason:
            logger.warning("SMC Apex: %s", reason)
        self.tick_errors[resolved] = reason

    def ingest(self, received: datetime, ticks: list[dict]):
        for tick in ticks:
            resolved = self.tokens.get(tick.get("instrument_token"))
            if resolved is None:
                continue
            stamp = tick.get("exchange_timestamp")
            price = float(tick.get("last_price") or 0)
            symbol, kind = resolved
            if not isfinite(price) or price <= 0:
                self.reject_tick(resolved, f"{symbol}: rejected {kind} tick with invalid price")
                continue
            source = "EXCHANGE"
            try:
                zero = isinstance(stamp, datetime) and stamp == datetime.fromtimestamp(0, stamp.tzinfo)
                if kind == "spot" and (stamp is None or zero):
                    # Index packets can omit exchange time; receipt time must never become a candle.
                    at, source = received, "RECEIPT"
                elif not isinstance(stamp, datetime) or zero:
                    self.reject_tick(resolved, f"{symbol}: rejected {kind} tick with missing exchange timestamp")
                    continue
                else:
                    at = stamp.astimezone(IST)
            except (OSError, OverflowError, ValueError):
                self.reject_tick(resolved, f"{symbol}: rejected {kind} tick with invalid exchange timestamp")
                continue
            if not -3 <= (received - at).total_seconds() <= 5:
                self.reject_tick(resolved, f"{symbol}: rejected stale or future-dated {kind} tick")
                continue
            previous = self.ticks.get(resolved)
            if previous and at < previous["at"]:
                continue
            self.ticks[resolved] = {"at": at, "received": received, "price": price,
                                    "timestamp_source": source,
                                    "depth": tick.get("depth") or {},
                                    "volume": float(tick.get("volume_traded") or 0),
                                    "ohlc": tick.get("ohlc") or {}}
            self.tick_errors.pop(resolved, None)
            if kind != "spot" or source != "EXCHANGE" or not session_open(at):
                continue
            slot = bucket(at, 1)
            building = self.building.get(symbol)
            if building and building["at"] != slot:
                self.finish_candle(symbol, building)
                building = None
            if building is None:
                building = {"at": slot, "open": price, "high": price, "low": price, "close": price,
                            "first": at, "last": at, "gap": 0.0}
                self.building[symbol] = building
            building["gap"] = max(building["gap"], (at - building["last"]).total_seconds())
            building.update(high=max(building["high"], price), low=min(building["low"], price),
                            close=price, last=at)

    def finish_candle(self, symbol: str, row: dict):
        if ((row["first"] - row["at"]).total_seconds() <= 5
                and (row["last"] - row["at"]).total_seconds() >= 55 and row["gap"] <= 10):
            with self.lock:
                self.store.candles(symbol, "1", [Candle(row["at"], row["open"], row["high"], row["low"], row["close"])])
        else:
            with self.lock:
                self.candle_errors.setdefault(symbol, set()).add(row["at"])
            logger.warning("SMC Apex: %s: incomplete live candle at %s rejected; awaiting exchange history",
                           symbol, row["at"].isoformat())

    def drain_ticks(self) -> bool:
        if self.overflow.is_set():
            self.building.clear()
            self.ticks.clear()
            while not self.events.empty():
                self.events.get_nowait()
            self.overflow.clear()
            self.fail("Tick queue overflow; incomplete candles discarded, new entries disabled")
            return False
        while not self.events.empty():
            received, ticks = self.events.get_nowait()
            self.ingest(received, ticks)
        return True

    def fresh(self, symbol: str, kind: str, now: datetime) -> dict:
        warning = self.tick_errors.get((symbol, kind))
        if warning:
            raise Blocked(warning)
        tick = self.ticks.get((symbol, kind))
        if not tick or not -3 <= (now - tick["at"]).total_seconds() <= 5 or (now - tick["received"]).total_seconds() > 5:
            raise Blocked(f"{symbol} {kind} feed missing or stale")
        return tick

    def depth(self, symbol: str, side: str, now: datetime) -> dict:
        future = self.fresh(symbol, "future", now)
        prices = quote_prices({"timestamp": future["at"], "last_price": future["price"],
                               "depth": future["depth"]}, now, .15)
        bids, asks = future["depth"]["buy"], future["depth"]["sell"]
        bid_volume = sum(int(r.get("quantity", 0)) for r in bids if float(r.get("price", 0)) > 0)
        ask_volume = sum(int(r.get("quantity", 0)) for r in asks if float(r.get("price", 0)) > 0)
        if min(bid_volume, ask_volume) <= 0:
            raise Blocked("Futures depth insufficient")
        imbalance = bid_volume / (bid_volume + ask_volume)
        if (side == "CE" and imbalance < .55) or (side == "PE" and imbalance > .45):
            raise Blocked("Futures displayed-depth imbalance does not confirm direction")
        return {**prices, "displayed_bid_fraction": imbalance,
                "source": "Nearest-expiry index future",
                "footprint": "UNAVAILABLE: Kite has no trade-by-trade aggressor flags"}

    def select_contract(self, symbol: str, side: str, spot: float, now: datetime) -> dict:
        venue = "BFO" if symbol == "SENSEX" else "NFO"
        rows = [r for r in self.catalog if r.get("name") == symbol and r.get("exchange") == venue
                and r.get("instrument_type") == side and r.get("expiry") and r["expiry"] >= now.date()
                and int(r.get("lot_size") or 0) > 0 and float(r.get("tick_size") or 0) > 0]
        if not rows:
            raise Blocked("No listed, unexpired option contract")
        expiry = min(r["expiry"] for r in rows)
        return min((r for r in rows if r["expiry"] == expiry), key=lambda r: abs(float(r["strike"]) - spot))

    def reserve_ai(self, identity: str, cfg: dict, now: datetime, pending: dict) -> tuple[dict | None, str | None, str | None]:
        with self.lock:
            cached = self.store.approval(identity)
            if cached:
                return cached, None, None
            try:
                maximum = int(cfg.get("SMCAPEX_AI_MAX_CALLS_PER_DAY") or "12")
            except ValueError as exc:
                raise Blocked("Independent AI daily call cap invalid") from exc
            if not 1 <= maximum <= 100 or self.store.ai_calls(now.date().isoformat()) >= maximum:
                raise Blocked("Independent AI daily call cap reached or invalid")
            last = self.store.get("last_ai", {}).get("at")
            if last and (now - datetime.fromisoformat(last)).total_seconds() < 300:
                raise Blocked("AI cooldown: at most one Apex call per five minutes")
            api_key = anthropic_key(cfg)
            model = cfg.get("SMCAPEX_AI_MODEL")
            if not api_key or not model:
                raise Blocked("Anthropic key or SMCAPEX_AI_MODEL not configured")
            self.store.approve(identity, now.date().isoformat(), pending)
            self.store.save("last_ai", {"at": now.isoformat()})
            return None, api_key, model

    def preopen_ai(self, symbol: str, signal: dict, cfg: dict, now: datetime) -> dict:
        day = now.date().isoformat()
        identity = f"preopen:{day}:{symbol}"
        if not signal.get("daily") or not signal["timeframes"]["5"]["last_at"]:
            return {"status": "UNAVAILABLE", "at": now.isoformat(), "session_date": day,
                    "reason": "Confirmed pre-open historical context unavailable."}
        with self.lock:
            evidence = {str(m): [r.json() for r in aggregate(self.store.history(symbol, "1"), m, now)[-10:]]
                        for m in (1, 3, 5, 15, 30, 60)}
        payload = {"index": symbol, "session_date": day, "daily": signal["daily"],
                   "timeframes": signal["timeframes"], "candles": evidence,
                   "historical_structures": signal["historical_structures"]}
        pending = {"status": "PENDING", "at": now.isoformat(), "session_date": day,
                   "reason": "Pre-open AI request pending or interrupted.", "evidence": payload}
        try:
            cached, api_key, model = self.reserve_ai(identity, cfg, now, pending)
        except Blocked as exc:
            return {"status": "WAITING", "at": now.isoformat(), "session_date": day, "reason": str(exc)}
        if cached:
            return cached
        if not api_key or not model:
            raise Blocked("Anthropic key or SMCAPEX_AI_MODEL not configured")
        try:
            with httpx.Client(timeout=10) as client:
                response = client.post("https://api.anthropic.com/v1/messages", headers={
                    "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    json={"model": model, "max_tokens": 600,
                          "system": (
                              "Assess only the supplied completed historical market data before the open. "
                              "FVG, sweep, structure break and order-block fields are historical evidence, "
                              "not a current setup or prediction. Identify missing or stale context. "
                              "Never invent prices, candles, order flow, market status or trading approvals. "
                              "Return ONLY JSON: bias (CE, PE or NEUTRAL), summary (short string), "
                              "risk_flags (array of short strings)."),
                          "messages": [{"role": "user", "content": json.dumps(payload)}]})
            if response.status_code != 200:
                raise Blocked(f"Pre-open AI unavailable (HTTP {response.status_code})")
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("content"), list):
                raise Blocked("Invalid pre-open AI response")
            if data.get("stop_reason") != "end_turn":
                raise Blocked("Incomplete pre-open AI response")
            if any(not isinstance(item, dict) or (item.get("type") == "text" and not isinstance(item.get("text"), str))
                   for item in data["content"]):
                raise Blocked("Invalid pre-open AI response")
            text = "".join(r.get("text", "") for r in data.get("content", []) if r.get("type") == "text")
            assessment = PreopenAssessment.model_validate_json(text)
            if not assessment.summary.strip() or any(not item.strip() or len(item) > 160 for item in assessment.risk_flags):
                raise Blocked("Invalid pre-open AI assessment")
            result = {"status": "COMPLETE", "at": now.isoformat(), "session_date": day,
                      **assessment.model_dump(), "usage": data.get("usage") or {}, "evidence": payload}
        except (httpx.HTTPError, ValueError, Blocked) as exc:
            result = {"status": "FAILED", "at": now.isoformat(), "session_date": day,
                      "reason": str(exc) if isinstance(exc, Blocked) else f"Pre-open AI failed: {type(exc).__name__}",
                      "evidence": payload}
            logger.warning("SMC Apex: %s", result["reason"])
        with self.lock:
            self.store.approve(identity, day, result)
        return result

    def ai(self, symbol: str, signal: dict, depth: dict, cfg: dict, now: datetime) -> dict:
        setup = signal["setup"]
        identity = f"{symbol}:{setup['id']}"
        pending = {"approved": False, "reason": "AI request pending or interrupted", "at": now.isoformat()}
        cached, api_key, model = self.reserve_ai(identity, cfg, now, pending)
        if cached:
            if cached.get("approved") and cached.get("contract") != signal["contract"]["symbol"]:
                raise Blocked("AI approval belongs to a different option contract")
            return cached
        if not api_key or not model:
            raise Blocked("Anthropic key or SMCAPEX_AI_MODEL not configured")
        with self.lock:
            evidence = {str(m): [r.json() for r in aggregate(self.store.history(symbol, "1"), m, now)[-10:]]
                        for m in (1, 3, 5, 15, 30, 60)}
        payload = {"index": symbol, "setup": setup, "checks": signal["checks"], "daily": signal["daily"],
                   "option": signal["contract"],
                   "timeframes": evidence, "confirmed_frame_context": signal.get("timeframes", {}), "depth": depth}
        preopen = signal.get("preopen_ai")
        if preopen and preopen.get("status") == "COMPLETE" and preopen.get("session_date") == now.date().isoformat():
            payload["preopen_context"] = {key: preopen[key] for key in ("at", "bias", "summary", "risk_flags")}
        try:
            with httpx.Client(timeout=10) as client:
                response = client.post("https://api.anthropic.com/v1/messages", headers={
                    "x-api-key": api_key, "anthropic-version": "2023-06-01"},
                    json={"model": model, "max_tokens": 600,
                          "system": (
                              "You are a veto-only SMC evidence auditor, not an order executor. "
                              "Reject contradictory, incomplete, stale or look-ahead evidence. "
                              "FVG is a geometric condition, never a guarantee. Displayed depth is cancellable, "
                              "not a real footprint. Pre-open context is an older model opinion, not approval or "
                              "live evidence. Do not invent prices, volume, aggressor flow or confidence. "
                              "Return ONLY JSON: approved (boolean), setup_id (copy setup.id), "
                              "side (copy setup.side), contract (copy option.symbol), reason (short string)."),
                          "messages": [{"role": "user", "content": json.dumps(payload)}]})
            if response.status_code != 200:
                raise Blocked(f"Anthropic approval unavailable (HTTP {response.status_code})")
            data = response.json()
            if data.get("stop_reason") != "end_turn":
                raise Blocked("Incomplete AI response")
            text = "".join(r.get("text", "") for r in data.get("content", []) if r.get("type") == "text")
            verdict = Verdict.model_validate_json(text)
            if (verdict.setup_id != setup["id"] or verdict.side != setup["side"]
                    or verdict.contract != signal["contract"]["symbol"] or not verdict.reason.strip()):
                raise Blocked("AI response does not match this setup")
            result = {**verdict.model_dump(), "at": now.isoformat(), "usage": data.get("usage") or {}}
        except (httpx.HTTPError, ValueError, Blocked) as exc:
            result = {"approved": False, "reason": str(exc) if isinstance(exc, Blocked)
                      else f"AI approval failed: {type(exc).__name__}", "at": now.isoformat()}
            logger.warning("SMC Apex: %s", result["reason"])
        with self.lock:
            self.store.approve(identity, now.date().isoformat(), result)
        return result

    def analyse(self, now: datetime, cfg: dict):
        for symbol in SYMBOLS:
            with self.lock:
                signal = evaluate(self.store.history(symbol, "1"), self.store.history(symbol, "D"), now)
                preopen = self.store.approval(f"preopen:{now.date().isoformat()}:{symbol}")
                if preopen:
                    signal["preopen_ai"] = {k: v for k, v in preopen.items() if k not in {"evidence", "usage"}}
                self.signals[symbol] = deepcopy(signal)
                saved = self.store.get(symbol)
                daily = self.store.get("daily")
            if now.weekday() < 5 and time(9, 0) <= now.time() < time(9, 15):
                preopen = self.preopen_ai(symbol, signal, cfg, now)
                with self.lock:
                    signal["preopen_ai"] = {k: v for k, v in preopen.items() if k not in {"evidence", "usage"}}
                    self.signals[symbol] = deepcopy(signal)
            if not signal["setup"]:
                continue
            try:
                spot = self.fresh(symbol, "spot", now)
                depth = self.depth(symbol, signal["setup"]["side"], now)
                signal["depth"] = depth
                contract = self.select_contract(symbol, signal["setup"]["side"], spot["price"], now)
                self.socket.subscribe([int(contract["instrument_token"])])
                self.socket.set_mode(KiteTicker.MODE_FULL, [int(contract["instrument_token"])])
                key = f"{contract['exchange']}:{contract['tradingsymbol']}"
                raw = self.kite.quote([key])[key]
                prices = quote_prices(raw, datetime.now(IST), IndexRisk(**saved).max_spread_percent if saved else 1)
                signal["contract"] = {"symbol": contract["tradingsymbol"], "exchange": contract["exchange"],
                                      "strike": contract["strike"], "expiry": str(contract["expiry"]),
                                      "lot_size": contract["lot_size"], **prices}
                verdict = self.ai(symbol, signal, depth, cfg, now)
                signal["ai"] = verdict
                if not self.drain_ticks():
                    raise Blocked("Tick queue overflow during AI approval; entries disabled")
                if not verdict["approved"]:
                    raise Blocked(verdict["reason"])
                signal["execution"] = "SIGNAL_ONLY" if not self.executor.enabled else "RISK_CHECK"
                if not self.executor.enabled:
                    continue
                if not saved or not daily:
                    raise Blocked("Save per-index and Apex daily risk limits first")
                live_now = datetime.now(IST)
                if (live_now - datetime.fromisoformat(verdict["at"])).total_seconds() > 45:
                    raise Blocked("AI approval expired")
                if (live_now - datetime.fromisoformat(signal["setup"]["trigger_at"])).total_seconds() > 90:
                    raise Blocked("Entry trigger expired")
                self.fresh(symbol, "spot", live_now)
                self.depth(symbol, signal["setup"]["side"], live_now)
                with self.lock:
                    current = evaluate(self.store.history(symbol, "1"), self.store.history(symbol, "D"), live_now)
                if not current["setup"] or current["setup"]["id"] != signal["setup"]["id"]:
                    raise Blocked("Rules changed during AI approval")
                current_spot = self.fresh(symbol, "spot", live_now)["price"]
                setup = signal["setup"]
                if (current_spot <= setup["fvg"]["lower"] if setup["side"] == "CE"
                        else current_spot >= setup["fvg"]["upper"]):
                    raise Blocked("FVG invalidated since completed trigger")
                if abs(current_spot - setup["underlying_entry"]) > .25 * abs(
                        setup["underlying_entry"] - setup["underlying_stop"]):
                    raise Blocked("Spot moved beyond the entry drift limit during AI approval")
                raw_quote = self.kite.quote([key])[key]
                if cfg.get("SMCAPEX_LIVE_ENABLED", "").lower() != "true":
                    raise Blocked("Deployment live permission is disabled")
                with self.lock:
                    latest_saved = self.store.get(symbol)
                    latest_daily = self.store.get("daily")
                    if self.connection_warnings():
                        raise Blocked("Connection recovery pending; new entries disabled")
                    if not latest_saved or not latest_daily:
                        raise Blocked("Save per-index and Apex daily risk limits first")
                    latest_risk = IndexRisk(**latest_saved)
                    prices = quote_prices(raw_quote, datetime.now(IST), latest_risk.max_spread_percent)
                    self.executor.enter(symbol, {**setup, "ai": verdict}, contract, prices, latest_risk,
                                        latest_daily["daily_loss"], datetime.now(IST))
                    self.executor.reconcile(datetime.now(IST))
                signal["execution"] = "ORDER_INTENT_RECORDED"
            except (Blocked, ValueError) as exc:
                signal["execution"] = "BLOCKED"
                signal["reason"] = str(exc)
            finally:
                with self.lock:
                    self.signals[symbol] = deepcopy(signal)

    def run(self):
        while not self.stop_event.is_set():
            stage = "configuration"
            try:
                now = datetime.now(IST)
                cfg = credentials()
                pair = (cfg["ZERODHA_API_KEY"], cfg["ZERODHA_ACCESS_TOKEN"])
                if pair != self.current_credentials or (self.feed != "CONNECTED" and monotonic() >= self.next_connection):
                    if monotonic() >= self.next_connection or (self.current_credentials is not None and pair != self.current_credentials):
                        self.next_connection = monotonic() + self.retry_seconds
                        stage = "feed"
                        self.connect(cfg)
                        self.retry_seconds = min(900, self.retry_seconds * 2)
                self.drain_ticks()
                stale_streams = self.stale_feed_streams(now)
                if stale_streams and session_open(now):
                    reason = "Zerodha tick feed stale: " + ", ".join(stale_streams)
                    self.connection_failure("feed", reason + "; reconnecting. New entries disabled.")
                    self.feed = "DISCONNECTED"
                    self.next_connection = monotonic() + 5
                    if self.socket:
                        self.socket.close()
                for symbol, row in list(self.building.items()):
                    if row["at"] + timedelta(minutes=1, seconds=5) <= now:
                        self.finish_candle(symbol, row)
                        del self.building[symbol]
                with self.lock:
                    stage = "broker"
                    self.executor.reconcile(now)
                for trade in self.executor.active():
                    if trade["state"] not in {"OPEN", "EXIT_WORKING"} or not self.kite:
                        continue
                    key = f"{trade['exchange']}:{trade['contract']}"
                    try:
                        prices = quote_prices(self.kite.quote([key])[key], datetime.now(IST), 5)
                        try:
                            spot = self.fresh(trade["symbol"], "spot", datetime.now(IST))["price"]
                        except Blocked:
                            spot = None
                        with self.lock:
                            self.executor.manage(trade, prices, spot, datetime.now(IST))
                    except Blocked as exc:
                        self.fail(f"Protective broker order remains active; monitoring blocked: {exc}")
                self.connection_recovered("broker")
                if self.feed == "CONNECTED":
                    self.retry_seconds = 60
                    if (self.last_history == 0 or (session_open(now) and monotonic() - self.last_history >= 60)
                            or (now.time() >= time(15, 31) and self.last_close_refresh != now.date())):
                        stage = "history"
                        self.history(now)
                        self.connection_recovered("history")
                    slot = now.replace(second=0, microsecond=0)
                    if now.second >= 5 and self.last_analysis != slot:
                        self.last_analysis = slot
                        self.drain_ticks()
                        stage = "analysis"
                        self.analyse(datetime.now(IST), cfg)
                        self.connection_recovered("analysis")
            except (ConnectionError, TimeoutError, RequestsConnectionError, RequestsTimeout, httpx.TransportError):
                descriptions = {
                    "configuration": "Apex configuration connection unavailable",
                    "feed": "Zerodha connection unavailable",
                    "history": "Zerodha candle history connection unavailable",
                    "broker": "Zerodha order monitoring connection unavailable; check any open Apex orders in Kite",
                    "analysis": "Zerodha market analysis connection unavailable",
                }
                self.connection_failure(stage, f"{descriptions[stage]}; retrying. New entries disabled.")
            except Exception as exc:
                # Worker boundary: explicitly disable entries, retain journal and show the failure.
                self.fail(f"Service failure: {type(exc).__name__}; inspect credentials/feed and broker orders")
            self.stop_event.wait(1)

    def status(self) -> dict:
        now = datetime.now(IST)
        with self.lock:
            indices = {}
            for symbol in SYMBOLS:
                tick = self.ticks.get((symbol, "spot"))
                age = (now - tick["at"]).total_seconds() if tick else None
                close = float(tick["ohlc"].get("close") or 0) if tick else 0
                cutoff = now.replace(hour=0, minute=0, second=0, microsecond=0)
                if now.time() >= time(15, 31):
                    cutoff += timedelta(days=1)
                daily = self.store.history(symbol, "D", limit=2, before=cutoff)
                previous = daily[-2].close if len(daily) > 1 else None
                last_close = ({"price": daily[-1].close, "session_date": daily[-1].at.date().isoformat(),
                               "change_percent": (daily[-1].close / previous - 1) * 100 if previous else None}
                              if daily else None)
                warnings = [self.tick_errors[(symbol, kind)] for kind in ("spot", "future")
                            if (symbol, kind) in self.tick_errors]
                if self.candle_errors.get(symbol):
                    warnings.append(f"{symbol}: incomplete live candle rejected; awaiting exchange history")
                indices[symbol] = {"price": tick["price"] if tick else None,
                                   "change_percent": (tick["price"] / close - 1) * 100 if close > 0 else None,
                                   "last_close": last_close,
                                   "timestamp_source": tick.get("timestamp_source", "EXCHANGE") if tick else None,
                                   "data_warning": "; ".join(warnings) or None,
                                   "age": age, "fresh": age is not None and -3 <= age <= 5
                                   and (symbol, "spot") not in self.tick_errors}
            return {"at": now.isoformat(), "feed": self.feed, "live": self.executor.enabled,
                    "error": self.executor.halted or self.error, "connection_warnings": self.connection_warnings(),
                    "indices": indices,
                    "signals": deepcopy(self.signals), "config": {s: self.store.get(s) for s in SYMBOLS},
                    "daily": self.store.get("daily"), "trades": self.store.trades()[-30:],
                    "ai_calls": self.store.ai_calls(now.date().isoformat()),
                    "daily_used": self.executor.budget_used(now.date().isoformat()),
                    "footprint": "Unavailable: displayed Kite futures depth is a proxy, not aggressor trade flow.",
                    "ml": "No trained model enabled. Rule/robust ATR validation only; no fabricated ML probability."}

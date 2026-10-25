"""Live order-flow recorder for the near-month NIFTY / BANKNIFTY / SENSEX futures.

What the data really is (shown to users as-is):
- Zerodha KiteTicker full mode sends roughly one snapshot per second: LTP, cumulative exchange volume,
  total pending bid/ask quantity and 5-level market depth. It does NOT say which side was the aggressor.
- Volume between two snapshots (difference of the exchange's cumulative volume) is classified with the
  Lee-Ready approach: quote rule against the quote prevailing *before* the trade (previous snapshot's
  best bid/ask), midpoint rule inside the spread, then the tick rule. That is an estimate of aggressor side.
- Volume that cannot be attributed (first snapshot, feed gaps longer than GAP_SECONDS) is kept as
  unclassified (`n`) and never assigned to buyers or sellers.
- All volume of one snapshot is placed at that snapshot's LTP row, so price levels are approximate.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

IST_OFFSET = 19_800
SESSION_OPEN_MIN = 9 * 60 + 15
SESSION_CLOSE_MIN = 15 * 60 + 30
GAP_SECONDS = 20
# Footprint storage rows (points). Display can aggregate further, never finer.
ROW_SIZE: Dict[str, float] = {"NIFTY": 1.0, "BANKNIFTY": 2.0, "SENSEX": 5.0}
ZONE_MIN_SNAPSHOTS = 8
ZONE_KEEP_SECONDS = 900
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "order_flow.sqlite3"


def to_epoch(value: Any) -> Optional[float]:
    if isinstance(value, datetime):
        if value.tzinfo is None:  # KiteTicker timestamps are naive IST
            return (value - datetime(1970, 1, 1)).total_seconds() - IST_OFFSET
        return value.timestamp()
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return None


def ist_minute_of_day(epoch: float) -> int:
    return int(((epoch + IST_OFFSET) // 60) % 1440)


def in_session(epoch: float) -> bool:
    return SESSION_OPEN_MIN <= ist_minute_of_day(epoch) < SESSION_CLOSE_MIN


def session_date(epoch: float) -> str:
    return datetime.fromtimestamp(epoch + IST_OFFSET, tz=timezone.utc).strftime("%Y-%m-%d")


def row_price(price: float, row: float) -> float:
    return round(round(price / row) * row, 2)


def _best(levels: Any) -> Optional[float]:
    if not isinstance(levels, list):
        return None
    for level in levels:
        try:
            price, qty = float(level.get("price") or 0), float(level.get("quantity") or 0)
        except (AttributeError, TypeError, ValueError):
            continue
        if price > 0 and qty > 0:
            return price
    return None


def _levels(levels: Any) -> List[tuple]:
    out = []
    if isinstance(levels, list):
        for level in levels[:5]:
            try:
                price, qty = float(level.get("price") or 0), float(level.get("quantity") or 0)
            except (AttributeError, TypeError, ValueError):
                continue
            if price > 0 and qty > 0:
                out.append((price, qty))
    return out


def _dom_side(levels: Any) -> List[List[float]]:
    """Exact 5-level depth rows [price, quantity, orders]; empty/zero rows are dropped, never filled."""
    out: List[List[float]] = []
    if isinstance(levels, list):
        for level in levels[:5]:
            try:
                price, qty = float(level.get("price") or 0), float(level.get("quantity") or 0)
                orders = int(level.get("orders") or 0)
            except (AttributeError, TypeError, ValueError):
                continue
            if price > 0 and qty > 0:
                out.append([price, qty, orders])
    return out


def _oi(tick: Dict[str, Any]) -> Optional[float]:
    value = tick.get("oi")
    if isinstance(value, (int, float)) and value > 0:
        return float(value)
    return None


class _State:
    def __init__(self, token: int):
        self.token = token
        self.prev_volume: Optional[float] = None
        self.prev_bid: Optional[float] = None
        self.prev_ask: Optional[float] = None
        self.last_trade_price: Optional[float] = None
        self.last_side = 0
        self.last_ts: Optional[float] = None
        self.minute: Optional[Dict[str, Any]] = None
        self.spot: Optional[float] = None
        self.zones: Dict[tuple, Dict[str, Any]] = {}
        self.dom: Optional[Dict[str, Any]] = None


def new_minute(t: int, price: float, baseline: bool) -> Dict[str, Any]:
    # gap=True means part of this minute's flow was not observed (no baseline at its start).
    # oi / oio: last and first open interest seen in the minute (None when Kite sent no OI).
    return {"t": t, "o": price, "h": price, "l": price, "c": price, "v": 0.0, "b": 0.0, "s": 0.0, "n": 0.0,
            "lv": {}, "bk": [0.0, 0.0, 0], "dp": [0.0, 0.0, 0], "sp": [0.0, 0], "spot": None,
            "gap": not baseline, "q": [0, 0, 0], "oi": None, "oio": None}


def classify(price: float, bid: Optional[float], ask: Optional[float],
             last_price: Optional[float], last_side: int) -> tuple:
    """Return (side, method): side +1 buy aggressor, -1 sell aggressor, 0 unknown; method 0 quote, 1 mid, 2 tick."""
    if bid is not None and ask is not None and ask > bid:
        if price >= ask:
            return 1, 0
        if price <= bid:
            return -1, 0
        mid = (bid + ask) / 2
        if price > mid:
            return 1, 1
        if price < mid:
            return -1, 1
    if last_price is not None:
        if price > last_price:
            return 1, 2
        if price < last_price:
            return -1, 2
        if last_side:
            return last_side, 2
    return 0, 2


class OrderFlowEngine:
    def __init__(self, db_path: Optional[Path] = None):
        self._lock = threading.Lock()
        self._states: Dict[str, _State] = {}
        self._today: Dict[str, List[Dict[str, Any]]] = {}
        self._loaded: Dict[str, str] = {}
        self._db_path = db_path if db_path is not None else Path(os.environ.get("ORDER_FLOW_DB_PATH") or DB_PATH)
        self._db_ready = False

    # ── storage ──────────────────────────────────────────────────────────────
    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self._db_path, timeout=5)
        try:
            if not self._db_ready:
                connection.execute("CREATE TABLE IF NOT EXISTS minutes (symbol TEXT, token INTEGER, t INTEGER,"
                                   " payload TEXT, PRIMARY KEY (symbol, token, t))")
                self._db_ready = True
            with connection:  # commit / rollback
                yield connection
        finally:
            connection.close()

    def _persist(self, symbol: str, token: int, minute: Dict[str, Any]) -> None:
        try:
            with self._connect() as connection:
                connection.execute("INSERT OR REPLACE INTO minutes VALUES (?, ?, ?, ?)",
                                   (symbol, token, minute["t"], json.dumps(minute, separators=(",", ":"))))
        except sqlite3.Error as error:
            print(f"⚠️ Order flow persist failed: {error}")

    def stored_minutes(self, symbol: str, start: int, end: int, token: Optional[int] = None) -> List[Dict[str, Any]]:
        try:
            with self._connect() as connection:
                query = "SELECT token, payload FROM minutes WHERE symbol = ? AND t >= ? AND t < ?"
                params: list = [symbol, start, end]
                if token is not None:
                    query += " AND token = ?"
                    params.append(token)
                rows = connection.execute(query + " ORDER BY t", params).fetchall()
        except sqlite3.Error:
            return []
        out = []
        for row_token, payload in rows:
            minute = json.loads(payload)
            minute["token"] = row_token
            minute["lv"] = {float(k): v for k, v in minute["lv"].items()}
            out.append(minute)
        return out

    def stored_sessions(self, symbol: str, limit: int = 30) -> List[str]:
        try:
            with self._connect() as connection:
                rows = connection.execute("SELECT DISTINCT (t + ?) / 86400 FROM minutes WHERE symbol = ?"
                                          " ORDER BY 1 DESC LIMIT ?", (IST_OFFSET, symbol, limit)).fetchall()
        except sqlite3.Error:
            return []
        return [session_date(day * 86400 - IST_OFFSET) for (day,) in rows]

    # ── live ingest (KiteTicker thread) ─────────────────────────────────────
    def ingest_spot(self, symbol: str, price: float) -> None:
        if price > 0:
            with self._lock:
                state = self._states.get(symbol)
                if state:
                    state.spot = price

    def ingest_futures(self, symbol: str, token: int, tick: Dict[str, Any]) -> None:
        price = float(tick.get("last_price") or 0)
        volume = tick.get("volume_traded")
        ts = to_epoch(tick.get("exchange_timestamp")) or to_epoch(tick.get("last_trade_time")) or time.time()
        if price <= 0 or volume is None or not in_session(ts):
            return
        volume = float(volume)
        depth = tick.get("depth") or {}
        bids, asks = _levels(depth.get("buy")), _levels(depth.get("sell"))
        bid, ask = _best(depth.get("buy")), _best(depth.get("sell"))
        row = ROW_SIZE.get(symbol, 1.0)
        finished = None
        with self._lock:
            state = self._states.get(symbol)
            if state is None or state.token != token:
                state = self._states[symbol] = _State(token)
            minute_t = int(ts // 60 * 60)
            baseline = (state.prev_volume is not None and state.last_ts is not None
                        and ts - state.last_ts <= GAP_SECONDS)
            minute = state.minute
            if minute is None or minute["t"] != minute_t:
                if minute is not None:
                    finished = minute
                minute = state.minute = new_minute(minute_t, price, baseline)
            minute["h"] = max(minute["h"], price)
            minute["l"] = min(minute["l"], price)
            minute["c"] = price
            traded = volume - state.prev_volume if state.prev_volume is not None else 0.0
            if traded > 0:
                minute["v"] += traded
                if not baseline:
                    minute["n"] += traded
                    minute["gap"] = True
                else:
                    side, method = classify(price, state.prev_bid, state.prev_ask, state.last_trade_price, state.last_side)
                    key = row_price(price, row)
                    cell = minute["lv"].setdefault(key, [0.0, 0.0])
                    if side > 0:
                        minute["b"] += traded
                        cell[0] += traded
                    elif side < 0:
                        minute["s"] += traded
                        cell[1] += traded
                    else:
                        minute["n"] += traded
                    if side:
                        minute["q"][method] += 1
                        state.last_side = side
                state.last_trade_price = price
            elif traded < 0:  # exchange counter reset / contract switch
                minute["gap"] = True
            total_bid, total_ask = tick.get("total_buy_quantity"), tick.get("total_sell_quantity")
            if total_bid and total_ask:
                minute["bk"][0] += float(total_bid)
                minute["bk"][1] += float(total_ask)
                minute["bk"][2] += 1
            if bids and asks:
                minute["dp"][0] += sum(q for _, q in bids)
                minute["dp"][1] += sum(q for _, q in asks)
                minute["dp"][2] += 1
            if bid is not None and ask is not None and ask > bid:
                minute["sp"][0] += ask - bid
                minute["sp"][1] += 1
            if state.spot:
                minute["spot"] = state.spot
            oi = _oi(tick)
            if oi is not None:
                minute["oi"] = oi
                if minute.get("oio") is None:
                    minute["oio"] = oi
            dom_bids, dom_asks = _dom_side(depth.get("buy")), _dom_side(depth.get("sell"))
            state.dom = {
                "ts": ts, "ltp": price, "bids": dom_bids, "asks": dom_asks,
                "totalBid": float(total_bid) if total_bid else None,
                "totalAsk": float(total_ask) if total_ask else None,
                "oi": oi, "oiHigh": float(tick["oi_day_high"]) if tick.get("oi_day_high") else None,
                "oiLow": float(tick["oi_day_low"]) if tick.get("oi_day_low") else None,
                "volume": volume,
            }
            self._track_zones(state, bids, asks, price, ts, row)
            state.prev_volume = volume
            state.prev_bid, state.prev_ask = bid, ask
            state.last_ts = ts
            if finished is not None:
                today = self._today.setdefault(symbol, [])
                if today and session_date(today[0]["t"]) != session_date(finished["t"]):
                    today.clear()
                    self._loaded.pop(symbol, None)
                today.append(finished)
        if finished is not None:
            self._persist(symbol, token, finished)

    def _track_zones(self, state: _State, bids: List[tuple], asks: List[tuple], price: float, ts: float, row: float) -> None:
        quantities = sorted(q for _, q in bids + asks)
        if len(quantities) >= 6:
            median = quantities[len(quantities) // 2]
            threshold = 3 * median
            for side, levels in (("bid", bids), ("ask", asks)):
                for level_price, qty in levels:
                    if qty < threshold:
                        continue
                    key = (side, row_price(level_price, row))
                    zone = state.zones.get(key)
                    if zone is None:
                        zone = state.zones[key] = {"side": side, "price": key[1], "first": ts, "seen": 0, "max": 0.0}
                    zone.update(last=ts, qty=qty, max=max(zone["max"], qty), seen=zone["seen"] + 1,
                                ratio=round(qty / median, 1) if median else None)
                    zone.pop("broken", None)
        for key, zone in list(state.zones.items()):
            if ts - zone["last"] > ZONE_KEEP_SECONDS:
                del state.zones[key]
            elif "broken" not in zone and ((zone["side"] == "bid" and price < zone["price"] - row) or
                                           (zone["side"] == "ask" and price > zone["price"] + row)):
                zone["broken"] = ts

    # ── reads ───────────────────────────────────────────────────────────────
    def current_token(self, symbol: str) -> Optional[int]:
        with self._lock:
            state = self._states.get(symbol)
            return state.token if state else None

    def last_tick(self, symbol: str) -> Optional[float]:
        with self._lock:
            state = self._states.get(symbol)
            return state.last_ts if state else None

    def dom(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Latest 5-level depth of the recorded contract (pending orders, not executed trades)."""
        with self._lock:
            state = self._states.get(symbol)
            if not state or not state.dom:
                return None
            dom = dict(state.dom, bids=[list(r) for r in state.dom["bids"]], asks=[list(r) for r in state.dom["asks"]])
            dom["token"] = state.token
            return dom

    def session_minutes(self, symbol: str, day: str) -> List[Dict[str, Any]]:
        start = int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp()) - IST_OFFSET
        end = start + 86_400
        with self._lock:
            state = self._states.get(symbol)
            token = state.token if state else None
            live = dict(state.minute, lv=dict(state.minute["lv"])) if state and state.minute and \
                start <= state.minute["t"] < end else None
            if live is not None:
                live["token"] = token
            today = self._today.get(symbol, [])
            cached = [dict(m, token=token) for m in today] if self._loaded.get(symbol) == day else None
        if cached is None:
            stored = self.stored_minutes(symbol, start, end)
            with self._lock:
                if live is not None:  # keep today's rolled minutes in memory to avoid re-reading SQLite
                    known = {m["t"] for m in self._today.get(symbol, [])}
                    self._today[symbol] = sorted(self._today.get(symbol, []) + [m for m in stored if m["t"] not in known],
                                                 key=lambda m: m["t"])
                    self._loaded[symbol] = day
            cached = stored
        minutes = {m["t"]: m for m in cached}
        if live is not None:
            minutes[live["t"]] = live
        return [minutes[t] for t in sorted(minutes)]

    def zones(self, symbol: str, now: Optional[float] = None) -> List[Dict[str, Any]]:
        with self._lock:
            state = self._states.get(symbol)
            if not state:
                return []
            reference = now or state.last_ts or time.time()
            out = []
            for zone in state.zones.values():
                if zone["seen"] < ZONE_MIN_SNAPSHOTS:
                    continue
                broken = zone.get("broken")
                if broken is None and reference - zone["last"] > 90:
                    continue
                if broken is not None and reference - broken > 300:
                    continue
                out.append({"side": zone["side"], "price": zone["price"], "qty": int(zone["qty"]),
                            "maxQty": int(zone["max"]), "ratio": zone.get("ratio"), "seen": zone["seen"],
                            "since": int(zone["first"]), "status": "broken" if broken is not None else "active"})
        return sorted(out, key=lambda zone: -zone["maxQty"])[:8]


order_flow_engine = OrderFlowEngine()

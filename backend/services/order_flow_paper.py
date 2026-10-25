"""Durable, confirmation-first paper book for the recorded chart OF signals."""

import json
import logging
import math
import queue
from datetime import datetime, timezone

INTERVAL = 5
DURATION = INTERVAL * 60
logger = logging.getLogger(__name__)
POLICY = {
    "source": "Same recorded OF BUY/SELL signals as Advanced/Futures charts; no inferred labels",
    "scope": "NIFTY, BANKNIFTY, SENSEX near-month futures, 5m; backend runs without chart tabs",
    "confirmation": "Observe signal live; wait one full candle, directional close and delta, no stop/T1 touch",
    "entry": "Next fresh same-token exchange tick after confirmation; never a historical fill",
    "risk": "Original structural stop and T2; at least 1.5R remaining, risk at most 1.25x original",
    "limits": "One open OF trade per index; no new entries at/after 15:10 IST; square-off from 15:25",
    "fills": "Adverse max(0.5, tick size) slippage on market fills; resting target filled at target",
    "accounting": "Futures points per unit only; fees excluded; not rupee P&L. Separate from cash-index books",
    "gaps": "Sampled ticks only; unknown intra-gap path flagged, never reconstructed as a fill",
}


def stamp(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def minute(epoch):
    return int((epoch + 19800) % 86400 // 60)


class OrderFlowPaperBook:
    def __init__(self, owner):
        self.owner = owner
        self.queue = queue.SimpleQueue()
        self.retry = []
        self.error = None
        self.last_scan = None

    @staticmethod
    def schema(db):
        db.executescript("""
            CREATE TABLE IF NOT EXISTS of_paper (
                id TEXT PRIMARY KEY, day TEXT NOT NULL, symbol TEXT NOT NULL,
                status TEXT NOT NULL, payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS of_paper_day ON of_paper(day);
            CREATE INDEX IF NOT EXISTS of_paper_active ON of_paper(symbol, status);
        """)

    def save(self, db, row, at, status=None, reason=None, **details):
        if status:
            row.update(status=status, reason=reason, updated_at=stamp(at))
            self.owner._event(db, row, datetime.fromtimestamp(at, timezone.utc), status,
                              reason=reason, **details)
        db.execute("INSERT INTO of_paper VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET "
                   "status=excluded.status, payload=excluded.payload",
                   (row["id"], row["day"], row["symbol"], row["status"], json.dumps(row)))

    @staticmethod
    def active(db, symbol):
        return [json.loads(r[0]) for r in db.execute(
            "SELECT payload FROM of_paper WHERE symbol=? AND status IN ('WATCHING','ARMED','OPEN')",
            (symbol,))]

    def observe(self, snapshot, now):
        self.last_scan = stamp(now)
        symbol = snapshot["symbol"]
        tick = snapshot.get("lastTick")
        fresh = snapshot.get("available") and tick is not None and -2 <= now - tick <= 10
        bars = snapshot.get("bars", [])
        token = snapshot.get("token")
        with self.owner.connect(write=True) as db:
            rows = self.active(db, symbol)
            for row in rows:
                if row["status"] == "OPEN":
                    continue
                if now >= row["expires"]:
                    self.save(db, row, now, "EXPIRED", "Confirmation/entry window elapsed; no backfill")
                    continue
                if token != row["token"]:
                    self.save(db, row, now, "REJECTED", "Recorded futures contract changed")
                    continue
                if not fresh:
                    continue
                opposite = any(s["side"] != row["side"] and s["time"] >= row["signal_time"]
                               for s in snapshot.get("signals", []))
                if opposite:
                    self.save(db, row, now, "REJECTED", "Opposite recorded order-flow signal")
                    continue
                # Even a recovered intrabar stop/target touch disqualifies the waiting setup.
                subsequent = [b for b in bars if b["t"] >= row["signal_time"] + DURATION]
                direction = 1 if row["side"] == "BUY" else -1
                if any((b["l"] <= row["stop"] or b["h"] >= row["t1"]) if direction == 1 else
                       (b["h"] >= row["stop"] or b["l"] <= row["t1"]) for b in subsequent):
                    self.save(db, row, now, "REJECTED", "Stop or first target touched before entry")
                    continue
                if row["status"] != "WATCHING" or now < row["confirm_end"]:
                    continue
                confirmation = next((b for b in bars if b["t"] == row["signal_time"] + DURATION), None)
                if not confirmation or not confirmation["closed"] or not confirmation["complete"]:
                    self.save(db, row, now, "REJECTED", "Confirmation candle incomplete or missing")
                    continue
                if not (direction * (confirmation["c"] - confirmation["o"]) > 0 and
                        direction * (confirmation["c"] - row["signal_price"]) > 0 and
                        direction * confirmation["d"] > 0):
                    self.save(db, row, now, "REJECTED", "Next candle did not confirm price and recorded delta")
                    continue
                row.update(confirmed_at=stamp(now), confirmed_epoch=now,
                           confirmation=confirmation, expires=now + 15)
                self.save(db, row, now, "ARMED", "Closed candle confirms direction and delta; waiting for a new tick")

            # Never adopt historical replay fills or signals first seen after the next candle closed.
            today = datetime.fromtimestamp(now + 19800, timezone.utc)
            if (not fresh or not 555 <= minute(now) < 905 or today.weekday() >= 5 or
                    snapshot.get("date") != today.date().isoformat() or
                    not isinstance(token, int) or token <= 0 or snapshot.get("interval") != INTERVAL):
                return
            for signal in snapshot.get("signals", []):
                end = signal["time"] + DURATION
                if not end <= now < end + 30:
                    continue
                signal_bar = next((b for b in bars if b["t"] == signal["time"]), None)
                if not signal_bar or not signal_bar["complete"] or not signal_bar["closed"]:
                    continue
                if signal["side"] not in ("BUY", "SELL"):
                    continue
                direction = 1 if signal["side"] == "BUY" else -1
                risk = direction * (signal["entry"] - signal["stop"])
                if not all(math.isfinite(signal[k]) for k in ("entry", "stop", "t1", "t2", "confidence")):
                    raise ValueError("Non-finite recorded order-flow plan")
                if risk <= 0 or direction * (signal["t2"] - signal["entry"]) <= 0:
                    raise ValueError("Invalid recorded order-flow risk levels")
                key = f'of-confirmed:{symbol}:{token}:{signal["id"]}'
                if db.execute("SELECT 1 FROM of_paper WHERE id=?", (key,)).fetchone():
                    continue
                row = {
                    "id": key, "day": snapshot["date"], "symbol": symbol, "token": token,
                    "contract": snapshot.get("contract"), "timeframe": INTERVAL, "side": signal["side"],
                    "signal_time": signal["time"], "signal_at": stamp(end), "signal_price": signal["entry"],
                    "observed_at": stamp(now), "confirm_end": end + DURATION,
                    "expires": end + DURATION + 30, "stop": signal["stop"], "t1": signal["t1"],
                    "target": signal["t2"], "original_risk": risk, "plan": signal,
                    "signal_candle": signal_bar,
                    "feed": {"lastTick": snapshot.get("lastTick"), "source": snapshot.get("source"),
                             "method": snapshot.get("method")},
                    "entry_at": None, "exit_at": None, "points": None, "data_gaps": 0,
                    "mfe": 0, "mae": 0,
                }
                blocked = any(r["status"] in ("OPEN", "ARMED", "WATCHING") for r in self.active(db, symbol))
                reason = ("Another OF setup/trade is active for this index" if blocked else
                          "Signal confidence below 60" if signal["confidence"] < 60 else None)
                self.save(db, row, now, "REJECTED" if reason else "WATCHING",
                          reason or "Recorded signal observed; waiting one full five-minute confirmation candle")

    def enqueue(self, symbol, token, price, at, received):
        self.queue.put((symbol, token, price, at, received))

    def drain(self):
        with self.owner.lock:
            if not self.retry:
                for _ in range(500):
                    try:
                        self.retry.append(self.queue.get_nowait())
                    except queue.Empty:
                        break
            if not self.retry:
                return
            with self.owner.connect(write=True) as db:
                for args in self.retry:
                    self.tick(db, *args)
            self.retry = []

    def tick(self, db, symbol, token, price, at, received):
        if not math.isfinite(price) or price <= 0:
            raise ValueError("Invalid futures paper tick")
        if not -2 <= received - at <= 10:
            logger.warning("Confirmed OF paper book rejected stale/future %s futures quote at %s", symbol, stamp(at))
            return
        for row in self.active(db, symbol):
            if row["token"] != token:
                continue
            if at < row.get("last_tick", 0) or (
                at == row.get("last_tick") and price == row.get("last_price")
            ):
                continue
            direction = 1 if row["side"] == "BUY" else -1
            slip = max(0.5, (row.get("contract") or {}).get("tickSize", 0.05))
            if row["status"] != "OPEN":
                if received >= row["expires"]:
                    self.save(db, row, received, "EXPIRED", "No timely confirmation/entry tick")
                elif at >= row["signal_time"] + DURATION and (
                    direction * (price - row["stop"]) <= 0 or direction * (price - row["t1"]) >= 0
                ):
                    self.save(db, row, received, "REJECTED", "Stop or first target touched while waiting")
                elif row["status"] == "ARMED" and at > row["confirmed_epoch"] and received > row["confirmed_epoch"]:
                    fill = price + direction * slip
                    risk = direction * (fill - row["stop"])
                    reward = direction * (row["target"] - fill)
                    if minute(at) >= 910 or minute(at) < 555:
                        self.save(db, row, received, "REJECTED", "Outside entry session")
                    elif direction * (price - row["signal_price"]) <= 0:
                        self.save(db, row, received, "REJECTED", "Price lost the signal level after confirmation")
                    elif risk <= 0 or risk > row["original_risk"] * 1.25 or reward < 1.5 * risk:
                        self.save(db, row, received, "REJECTED", "Entry chased price or less than 1.5R remains")
                    else:
                        row.update(entry_at=stamp(at), entry_price=round(fill, 4),
                                   last_tick=at, last_price=price, unrealized_points=-slip)
                        self.save(db, row, received, "OPEN", "First fresh same-contract tick after confirmation",
                                  trigger=price, fill=fill, risk_reward=reward / risk)
                continue
            if at - row["last_tick"] > 30:
                row["data_gaps"] += 1
                self.owner._event(db, row, datetime.fromtimestamp(at, timezone.utc), "DATA_GAP",
                                  previous_tick=stamp(row["last_tick"]), note="Unobserved intragap path unknown")
            move = direction * (price - row["entry_price"])
            row.update(last_tick=at, last_price=price, unrealized_points=round(move, 4),
                       mfe=max(row["mfe"], move), mae=max(row["mae"], -move))
            reason = ("SESSION_CLOSE" if stamp(at)[:10] != stamp(row["signal_time"])[:10] or minute(at) >= 925 else
                      "STOP_LOSS" if direction * (price - row["stop"]) <= 0 else
                      "TARGET" if direction * (price - row["target"]) >= 0 else None)
            if reason:
                fill = row["target"] if reason == "TARGET" else price - direction * slip
                row.update(exit_at=stamp(at), exit_price=round(fill, 4),
                           points=round(direction * (fill - row["entry_price"]), 4))
                self.save(db, row, received, "CLOSED", reason, trigger=price, fill=fill)
            else:
                self.save(db, row, received)

    def snapshot(self, db, day, limit=100, offset=0):
        rows = [json.loads(r[0]) for r in db.execute(
            "SELECT payload FROM of_paper WHERE day=? ORDER BY rowid DESC LIMIT ? OFFSET ?",
            (day, limit, offset))]
        counts = dict(db.execute("SELECT status,count(*) FROM of_paper WHERE day=? GROUP BY status", (day,)).fetchall())
        points = db.execute("SELECT coalesce(sum(json_extract(payload,'$.points')),0) "
                            "FROM of_paper WHERE day=? AND status='CLOSED'", (day,)).fetchone()[0]
        return {"policy": POLICY, "setups": rows, "counts": counts, "net_points": round(points, 4),
                "total": sum(counts.values()), "error": self.error, "last_scan": self.last_scan}

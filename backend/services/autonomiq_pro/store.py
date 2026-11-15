"""SQLite persistence for AUTONOMIQ PRO with versioned schema migrations."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

IST = timezone(timedelta(hours=5, minutes=30))
DEFAULT_DB = Path(__file__).resolve().parents[2] / "data" / "autonomiq_pro" / "autonomiq_pro.sqlite3"

MIGRATIONS: list[str] = [
    # 1 — initial schema
    """
    CREATE TABLE runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE analysis_cycles (
        id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, finished_at TEXT,
        trigger TEXT NOT NULL, status TEXT NOT NULL, error TEXT, summary TEXT, payload TEXT);
    CREATE TABLE decisions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, cycle_id INTEGER NOT NULL, created_at TEXT NOT NULL,
        day TEXT NOT NULL, symbol TEXT NOT NULL, action TEXT NOT NULL, strength TEXT, score REAL,
        approved INTEGER NOT NULL DEFAULT 0, payload TEXT NOT NULL);
    CREATE INDEX decisions_symbol_created ON decisions(symbol, created_at);
    CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, level TEXT NOT NULL,
        symbol TEXT, message TEXT NOT NULL);
    CREATE TABLE ai_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, day TEXT NOT NULL, agent TEXT NOT NULL,
        model TEXT NOT NULL, status TEXT NOT NULL, input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0, cache_read_tokens INTEGER NOT NULL DEFAULT 0,
        cache_write_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        latency_ms INTEGER, error TEXT);
    CREATE INDEX ai_calls_day ON ai_calls(day);
    CREATE TABLE paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT, signal_key TEXT NOT NULL UNIQUE, day TEXT NOT NULL,
        symbol TEXT NOT NULL, exchange TEXT NOT NULL, tradingsymbol TEXT NOT NULL, option_type TEXT NOT NULL,
        lot_size INTEGER NOT NULL, lots INTEGER NOT NULL, entry REAL NOT NULL, stop_loss REAL NOT NULL,
        trailing_sl REAL NOT NULL, target1 REAL NOT NULL, target2 REAL NOT NULL, risk REAL NOT NULL,
        status TEXT NOT NULL, opened_at TEXT NOT NULL, closed_at TEXT, last_price REAL, exit_price REAL,
        exit_reason TEXT, pnl REAL);
    CREATE INDEX paper_trades_status ON paper_trades(status);
    CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, actor TEXT NOT NULL,
        action TEXT NOT NULL, detail TEXT);
    """,
    """
    ALTER TABLE paper_trades ADD COLUMN last_quote_at TEXT;
    ALTER TABLE paper_trades ADD COLUMN last_price_source TEXT;
    """,
]


class Store:
    def __init__(self, path: Path | str = DEFAULT_DB):
        self.path = Path(path)
        self.lock = threading.RLock()
        self.conn: sqlite3.Connection | None = None

    def open(self) -> None:
        with self.lock:
            if self.conn is not None:
                return
            if str(self.path) != ":memory:":
                self.path.parent.mkdir(parents=True, exist_ok=True)
            self.conn = sqlite3.connect(str(self.path), check_same_thread=False, timeout=10)
            try:
                self.conn.row_factory = sqlite3.Row
                self.conn.execute("PRAGMA journal_mode=WAL")
                self.conn.execute("PRAGMA foreign_keys=ON")
                self.migrate()
            except sqlite3.Error:
                self.conn.close()
                self.conn = None
                raise

    def migrate(self) -> int:
        with self.lock:
            version = self.conn.execute("PRAGMA user_version").fetchone()[0]
            for index in range(version, len(MIGRATIONS)):
                try:
                    self.conn.executescript(
                        f"BEGIN IMMEDIATE;\n{MIGRATIONS[index]}\nPRAGMA user_version = {index + 1};\nCOMMIT;"
                    )
                except sqlite3.Error:
                    self.conn.rollback()
                    raise
            return self.conn.execute("PRAGMA user_version").fetchone()[0]

    def close(self) -> None:
        with self.lock:
            if self.conn is not None:
                self.conn.close()
                self.conn = None

    def _exec(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self.lock, self.conn:
            return self.conn.execute(sql, params)

    def _all(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(row) for row in self.conn.execute(sql, params).fetchall()]

    # ── runtime toggles ──────────────────────────────────────────────
    def get_state(self, key: str, default: Any = None) -> Any:
        rows = self._all("SELECT value FROM runtime_state WHERE key = ?", (key,))
        return json.loads(rows[0]["value"]) if rows else default

    def set_state(self, key: str, value: Any) -> None:
        self._exec("INSERT INTO runtime_state(key, value, updated_at) VALUES(?,?,?) "
                   "ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                   (key, json.dumps(value), _now()))

    # ── audit / alerts ───────────────────────────────────────────────
    def audit(self, actor: str, action: str, detail: Any = None) -> None:
        self._exec("INSERT INTO audit_log(created_at, actor, action, detail) VALUES(?,?,?,?)",
                   (_now(), actor, action, json.dumps(detail, default=str)))

    def add_alert(self, level: str, message: str, symbol: str | None = None) -> None:
        self._exec("INSERT INTO alerts(created_at, level, symbol, message) VALUES(?,?,?,?)",
                   (_now(), level, symbol, message))

    def alerts(self, limit: int = 30) -> list[dict]:
        return self._all("SELECT * FROM alerts ORDER BY id DESC LIMIT ?", (limit,))

    def audit_entries(self, limit: int = 50) -> list[dict]:
        return self._all("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?", (limit,))

    # ── analysis cycles / decisions ──────────────────────────────────
    def start_cycle(self, trigger: str) -> int:
        return self._exec("INSERT INTO analysis_cycles(started_at, trigger, status) VALUES(?,?,?)",
                          (_now(), trigger, "RUNNING")).lastrowid

    def finish_cycle(self, cycle_id: int, status: str, summary: str | None = None,
                     payload: Any = None, error: str | None = None) -> None:
        self._exec("UPDATE analysis_cycles SET finished_at=?, status=?, summary=?, payload=?, error=? WHERE id=?",
                   (_now(), status, summary, json.dumps(payload, default=str) if payload is not None else None,
                    error, cycle_id))

    def last_cycle(self, completed_only: bool = True) -> dict | None:
        where = "WHERE payload IS NOT NULL" if completed_only else ""
        rows = self._all(f"SELECT * FROM analysis_cycles {where} ORDER BY id DESC LIMIT 1")
        if not rows:
            return None
        row = rows[0]
        row["payload"] = json.loads(row["payload"]) if row.get("payload") else None
        return row

    def add_decision(self, cycle_id: int, day: str, decision: dict) -> int:
        return self._exec(
            "INSERT INTO decisions(cycle_id, created_at, day, symbol, action, strength, score, approved, payload) "
            "VALUES(?,?,?,?,?,?,?,?,?)",
            (cycle_id, _now(), day, decision["symbol"], decision["action"], decision.get("strength"),
             decision.get("score"), int(bool(decision.get("risk", {}).get("approved"))),
             json.dumps(decision, default=str))).lastrowid

    def decisions(self, limit: int = 30) -> list[dict]:
        rows = self._all("SELECT id, cycle_id, created_at, symbol, action, strength, score, approved, payload "
                         "FROM decisions ORDER BY id DESC LIMIT ?", (limit,))
        for row in rows:
            payload = json.loads(row.pop("payload"))
            row["reasoning"] = payload.get("reasoning")
            row["contract"] = (payload.get("plan") or {}).get("tradingsymbol")
        return rows

    # ── AI usage ─────────────────────────────────────────────────────
    def record_ai_call(self, day: str, agent: str, model: str, status: str, input_tokens: int = 0,
                       output_tokens: int = 0, cost_usd: float = 0.0, latency_ms: int | None = None,
                       error: str | None = None, cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> None:
        self._exec("INSERT INTO ai_calls(created_at, day, agent, model, status, input_tokens, output_tokens, "
                   "cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, error) "
                   "VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                   (_now(), day, agent, model, status, input_tokens, output_tokens, cache_read_tokens,
                    cache_write_tokens, cost_usd, latency_ms, error))

    def ai_usage(self, day: str) -> dict:
        """Usage for one day (YYYY-MM-DD) or one month (YYYY-MM)."""
        row = self._all("SELECT COUNT(*) calls, COALESCE(SUM(input_tokens),0) input_tokens, "
                        "COALESCE(SUM(output_tokens),0) output_tokens, "
                        "COALESCE(SUM(cache_read_tokens),0) cache_read_tokens, COALESCE(SUM(cost_usd),0) cost_usd, "
                        "COALESCE(SUM(status != 'OK'),0) failures FROM ai_calls WHERE day LIKE ?",
                        (f"{day}%",))[0]
        row["total_tokens"] = row["input_tokens"] + row["output_tokens"]
        row["cost_usd"] = round(row["cost_usd"], 4)
        return row

    def ai_calls(self, limit: int = 20) -> list[dict]:
        return self._all("SELECT created_at, agent, model, status, input_tokens, output_tokens, cost_usd, "
                         "latency_ms, error FROM ai_calls ORDER BY id DESC LIMIT ?", (limit,))

    # ── paper trades ─────────────────────────────────────────────────
    def open_paper_trade(self, trade: dict) -> int | None:
        try:
            return self._exec(
                "INSERT INTO paper_trades(signal_key, day, symbol, exchange, tradingsymbol, option_type, lot_size, "
                "lots, entry, stop_loss, trailing_sl, target1, target2, risk, status, opened_at, last_price) "
                "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'OPEN',?,?)",
                (trade["signal_key"], trade["day"], trade["symbol"], trade["exchange"], trade["tradingsymbol"],
                 trade["option_type"], trade["lot_size"], trade["lots"], trade["entry"], trade["stop_loss"],
                 trade["trailing_sl"], trade["target1"], trade["target2"], trade["risk"], _now(),
                 trade["entry"])).lastrowid
        except sqlite3.IntegrityError:
            return None

    def update_paper_trade(self, trade_id: int, **fields: Any) -> None:
        if not fields:
            return
        columns = ", ".join(f"{name} = ?" for name in fields)
        self._exec(f"UPDATE paper_trades SET {columns} WHERE id = ?", (*fields.values(), trade_id))

    def open_trades(self) -> list[dict]:
        return self._all("SELECT * FROM paper_trades WHERE status = 'OPEN' ORDER BY id")

    def trades(self, limit: int = 50) -> list[dict]:
        return self._all("SELECT * FROM paper_trades ORDER BY id DESC LIMIT ?", (limit,))

    def day_stats(self, day: str) -> dict:
        row = self._all("SELECT COUNT(*) trades, COALESCE(SUM(pnl),0) realized, "
                        "COALESCE(SUM(pnl > 0),0) wins, COALESCE(SUM(pnl <= 0 AND status='CLOSED'),0) losses "
                        "FROM paper_trades WHERE day = ?", (day,))[0]
        row["realized"] = round(row["realized"], 2)
        return row

    def performance(self) -> dict:
        row = self._all("SELECT COUNT(*) trades, COALESCE(SUM(pnl),0) pnl, COALESCE(SUM(pnl > 0),0) wins, "
                        "COALESCE(MAX(pnl),0) best, COALESCE(MIN(pnl),0) worst FROM paper_trades "
                        "WHERE status='CLOSED'")[0]
        row["win_rate"] = round(row["wins"] * 100 / row["trades"], 1) if row["trades"] else None
        row["pnl"] = round(row["pnl"], 2)
        return row


def _now() -> str:
    return datetime.now(IST).isoformat(timespec="seconds")

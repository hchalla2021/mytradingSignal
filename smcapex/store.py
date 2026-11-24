"""Durable candle memory, configuration and exclusively Apex-owned order intents."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path

from .engine import Candle


class Store:
    def __init__(self, path: str):
        if path != ":memory:":
            Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS candles(
                symbol TEXT, frame TEXT, at TEXT, payload TEXT,
                PRIMARY KEY(symbol, frame, at));
            CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, payload TEXT);
            CREATE TABLE IF NOT EXISTS trades(id TEXT PRIMARY KEY, payload TEXT);
            CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, day TEXT, payload TEXT);
        """)

    def candles(self, symbol: str, frame: str, rows: list[Candle]) -> None:
        with self.db:
            self.db.executemany("INSERT OR REPLACE INTO candles VALUES(?,?,?,?)",
                                [(symbol, frame, r.at.isoformat(), json.dumps(r.json())) for r in rows])

    def history(self, symbol: str, frame: str, limit: int = 30000, before: datetime | None = None) -> list[Candle]:
        if before is None:
            rows = self.db.execute(
                "SELECT payload FROM candles WHERE symbol=? AND frame=? ORDER BY at DESC LIMIT ?",
                (symbol, frame, limit)).fetchall()
        else:
            rows = self.db.execute(
                "SELECT payload FROM candles WHERE symbol=? AND frame=? AND at<? ORDER BY at DESC LIMIT ?",
                (symbol, frame, before.isoformat(), limit)).fetchall()
        result = []
        for row in reversed(rows):
            data = json.loads(row["payload"])
            data["at"] = datetime.fromisoformat(data["at"])
            result.append(Candle(**data))
        return result

    def get(self, key: str, default=None):
        row = self.db.execute("SELECT payload FROM settings WHERE key=?", (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def save(self, key: str, value: dict) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, json.dumps(value)))

    def trade(self, value: dict) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO trades VALUES(?,?)",
                            (value["id"], json.dumps(value)))

    def trades(self) -> list[dict]:
        return [json.loads(r[0]) for r in self.db.execute("SELECT payload FROM trades ORDER BY rowid")]

    def approval(self, key: str) -> dict | None:
        row = self.db.execute("SELECT payload FROM approvals WHERE id=?", (key,)).fetchone()
        return json.loads(row[0]) if row else None

    def approve(self, key: str, day: str, value: dict) -> None:
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO approvals VALUES(?,?,?)",
                            (key, day, json.dumps(value)))

    def ai_calls(self, day: str) -> int:
        return self.db.execute("SELECT COUNT(*) FROM approvals WHERE day=?", (day,)).fetchone()[0]

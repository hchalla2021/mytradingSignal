"""ExpiryEdge configuration and authoritative listed-expiry inspection."""

from __future__ import annotations

import contextlib
import sqlite3
from datetime import date, datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

WEEKDAYS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")
IST = ZoneInfo("Asia/Kolkata")
SYMBOLS = ("NIFTY", "BANKNIFTY", "SENSEX")
UNDERLYINGS = {
    "NIFTY": ("NFO", "NIFTY"),
    "BANKNIFTY": ("NFO", "BANKNIFTY"),
    "SENSEX": ("BFO", "SENSEX"),
}
DB_PATH = Path(__file__).resolve().parent.parent / "data" / "expiryedge" / "config.sqlite3"


def _connect(path: Path = DB_PATH) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(path), timeout=5)
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA busy_timeout=5000")
    connection.execute(
        "CREATE TABLE IF NOT EXISTS expiryedge_config "
        "(id INTEGER PRIMARY KEY CHECK(id=1), weekday TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    connection.execute(
        "CREATE TABLE IF NOT EXISTS expiryedge_schedules "
        "(symbol TEXT PRIMARY KEY, weekday TEXT NOT NULL, updated_at TEXT NOT NULL)"
    )
    return connection


def _migrate_legacy_config(connection: sqlite3.Connection) -> None:
    row = connection.execute(
        "SELECT weekday, updated_at FROM expiryedge_config WHERE id=1"
    ).fetchone()
    if not row:
        return
    connection.executemany(
        "INSERT OR IGNORE INTO expiryedge_schedules(symbol, weekday, updated_at) VALUES(?, ?, ?)",
        [(symbol, row[0], row[1]) for symbol in SYMBOLS],
    )


def get_config(path: Path = DB_PATH) -> dict[str, Any]:
    with contextlib.closing(_connect(path)) as connection, connection:
        _migrate_legacy_config(connection)
        rows = connection.execute(
            "SELECT symbol, weekday, updated_at FROM expiryedge_schedules"
        ).fetchall()
    saved = {symbol: {"weekday": weekday, "updated_at": updated_at}
             for symbol, weekday, updated_at in rows}
    return {"schedules": {symbol: saved.get(symbol, {"weekday": None, "updated_at": None})
                          for symbol in SYMBOLS}}


def save_config(symbol: str, weekday: str, path: Path = DB_PATH) -> dict[str, Any]:
    if symbol not in SYMBOLS:
        raise ValueError("Unsupported ExpiryEdge index")
    if weekday not in WEEKDAYS:
        raise ValueError("Expiry weekday must be Monday through Friday")
    updated_at = datetime.now(IST).isoformat()
    with contextlib.closing(_connect(path)) as connection, connection:
        _migrate_legacy_config(connection)
        connection.execute(
            "INSERT INTO expiryedge_schedules(symbol, weekday, updated_at) VALUES(?, ?, ?) "
            "ON CONFLICT(symbol) DO UPDATE SET weekday=excluded.weekday, updated_at=excluded.updated_at",
            (symbol, weekday, updated_at),
        )
    return {"symbol": symbol, "weekday": weekday, "updated_at": updated_at}


def listed_expiries(rows: list[dict[str, Any]], underlying: str, today: date) -> list[dict[str, Any]]:
    """Summarize actual option expiries from the current broker instrument master."""
    contracts: dict[date, dict[str, Any]] = {}
    for row in rows:
        if (row.get("name") != underlying or row.get("instrument_type") not in {"CE", "PE"}
                or not row.get("instrument_token") or not row.get("lot_size")):
            continue
        expiry = row.get("expiry")
        if isinstance(expiry, datetime):
            expiry = expiry.date()
        elif isinstance(expiry, str):
            try:
                expiry = date.fromisoformat(expiry)
            except ValueError:
                continue
        if not isinstance(expiry, date) or expiry < today:
            continue
        summary = contracts.setdefault(expiry, {"expiry": expiry.isoformat(), "contracts": 0, "lot_sizes": set()})
        summary["contracts"] += 1
        summary["lot_sizes"].add(int(row["lot_size"]))
    return [
        {
            "expiry": item["expiry"],
            "listed_option_contracts": item["contracts"],
            "lot_sizes": sorted(item["lot_sizes"]),
        }
        for _, item in sorted(contracts.items())
    ]

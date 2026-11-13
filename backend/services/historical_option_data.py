"""Offline catalog for validated daily option bhavcopy data.

This module is deliberately not imported by live signal or order-execution paths.
"""

import argparse
import csv
import json
import math
import sqlite3
from dataclasses import asdict, dataclass
from datetime import date
from pathlib import Path


DATA_DIR = Path(__file__).resolve().parents[1] / "data" / "Option Data"
DEFAULT_DB = DATA_DIR / "options_history.sqlite3"
EXPECTED_FILES = {
    "NIFTY": "NIFTY_Option_Data_Historic.csv",
    "BANKNIFTY": "BANKNIFTY_Option_Data_Historic.csv",
    "SENSEX": "SENSEX_Option_Data_Historic.csv",
}
REQUIRED_COLUMNS = {
    "trade_date", "symbol", "expiry_date", "strike", "option_type",
    "open", "high", "low", "close", "volume_contracts", "open_interest",
}


class HistoricalOptionDataError(ValueError):
    """Raised when a source file cannot be safely indexed."""


@dataclass(frozen=True)
class OptionDailyBar:
    trade_date: str
    symbol: str
    expiry_date: str
    strike: float
    option_type: str
    open: float
    high: float
    low: float
    close: float
    ohlc_valid: bool
    volume_contracts: int
    open_interest: int
    change_in_open_interest: int | None
    underlying_price: float | None
    source_file: str


def _number(row, name, line, *, integer=False, required=True, positive=False, allow_negative=False):
    raw = row.get(name, "")
    if raw is None or not raw.strip():
        if required:
            raise HistoricalOptionDataError(f"line {line}: missing {name}")
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError) as error:
        raise HistoricalOptionDataError(f"line {line}: invalid {name}={raw!r}") from error
    if not math.isfinite(value) or (not allow_negative and value < 0) or (positive and value <= 0):
        raise HistoricalOptionDataError(f"line {line}: out-of-range {name}={raw!r}")
    if integer and not value.is_integer():
        raise HistoricalOptionDataError(f"line {line}: non-integer {name}={raw!r}")
    return int(value) if integer else value


def parse_row(row, line, expected_symbol, source_file):
    try:
        trade_day = date.fromisoformat(row["trade_date"])
        expiry_day = date.fromisoformat(row["expiry_date"])
    except (KeyError, TypeError, ValueError) as error:
        raise HistoricalOptionDataError(f"line {line}: invalid trade/expiry date") from error
    symbol = (row.get("symbol") or "").strip().upper()
    if symbol != expected_symbol:
        raise HistoricalOptionDataError(
            f"line {line}: expected {expected_symbol}, found {symbol or '<empty>'}"
        )
    if expiry_day < trade_day:
        raise HistoricalOptionDataError(f"line {line}: expiry precedes trade date")
    option_type = (row.get("option_type") or "").strip().upper()
    if option_type not in ("CE", "PE"):
        raise HistoricalOptionDataError(f"line {line}: option_type must be CE or PE")
    values = {
        key: _number(row, key, line)
        for key in ("open", "high", "low", "close")
    }
    ohlc_valid = (
        values["high"] >= max(values["open"], values["low"], values["close"])
        and values["low"] <= min(values["open"], values["high"], values["close"])
    )
    return OptionDailyBar(
        trade_date=trade_day.isoformat(),
        symbol=symbol,
        expiry_date=expiry_day.isoformat(),
        strike=_number(row, "strike", line, positive=True),
        option_type=option_type,
        open=values["open"],
        high=values["high"],
        low=values["low"],
        close=values["close"],
        ohlc_valid=ohlc_valid,
        volume_contracts=_number(row, "volume_contracts", line, integer=True),
        open_interest=_number(row, "open_interest", line, integer=True),
        change_in_open_interest=_number(
            row, "change_in_open_interest", line, integer=True, required=False, allow_negative=True
        ),
        underlying_price=_number(row, "underlying_price", line, required=False),
        source_file=source_file,
    )


def _connect(db_path):
    connection = sqlite3.connect(str(db_path), timeout=30)
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def _initialize(connection):
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS option_daily (
            trade_date TEXT NOT NULL,
            symbol TEXT NOT NULL,
            expiry_date TEXT NOT NULL,
            strike REAL NOT NULL,
            option_type TEXT NOT NULL CHECK(option_type IN ('CE', 'PE')),
            open REAL NOT NULL,
            high REAL NOT NULL,
            low REAL NOT NULL,
            close REAL NOT NULL,
            ohlc_valid INTEGER NOT NULL CHECK(ohlc_valid IN (0, 1)),
            volume_contracts INTEGER NOT NULL,
            open_interest INTEGER NOT NULL,
            change_in_open_interest INTEGER,
            underlying_price REAL,
            source_file TEXT NOT NULL,
            PRIMARY KEY (trade_date, symbol, expiry_date, strike, option_type)
        );
        CREATE INDEX IF NOT EXISTS idx_option_daily_lookup
            ON option_daily(symbol, trade_date, expiry_date, option_type, strike);
        CREATE TABLE IF NOT EXISTS option_sources (
            symbol TEXT PRIMARY KEY,
            source_file TEXT NOT NULL,
            source_bytes INTEGER NOT NULL,
            source_mtime_ns INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            rejected_count INTEGER NOT NULL,
            first_trade_date TEXT NOT NULL,
            last_trade_date TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS option_rejections (
            symbol TEXT NOT NULL,
            source_file TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            error TEXT NOT NULL,
            raw_row TEXT NOT NULL,
            PRIMARY KEY (symbol, line_number)
        );
        """
    )
    connection.commit()


def ingest_csv(csv_path, db_path=DEFAULT_DB, expected_symbol=None):
    """Validate and atomically replace one symbol's indexed source."""
    csv_path = Path(csv_path)
    symbol = (expected_symbol or csv_path.name.split("_", 1)[0]).upper()
    if symbol not in EXPECTED_FILES:
        raise HistoricalOptionDataError(f"unsupported symbol: {symbol}")
    if not csv_path.is_file():
        raise HistoricalOptionDataError(f"source file does not exist: {csv_path}")
    db_path = Path(db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    source_name = csv_path.name
    connection = _connect(db_path)
    try:
        _initialize(connection)
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM option_daily WHERE symbol=?", (symbol,))
        connection.execute("DELETE FROM option_rejections WHERE symbol=?", (symbol,))
        first_date = last_date = None
        count = 0
        rejected = 0
        invalid_ohlc_count = 0
        rejection_samples = []
        with csv_path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            if not reader.fieldnames or not REQUIRED_COLUMNS.issubset(reader.fieldnames):
                missing = sorted(REQUIRED_COLUMNS - set(reader.fieldnames or ()))
                raise HistoricalOptionDataError(f"missing required columns: {', '.join(missing)}")
            for line, row in enumerate(reader, start=2):
                try:
                    bar = parse_row(row, line, symbol, source_name)
                except HistoricalOptionDataError as error:
                    connection.execute(
                        "INSERT INTO option_rejections VALUES (?, ?, ?, ?, ?)",
                        (symbol, source_name, line, str(error), json.dumps(row, sort_keys=True)),
                    )
                    rejected += 1
                    if len(rejection_samples) < 20:
                        rejection_samples.append({"line": line, "error": str(error)})
                    continue
                try:
                    connection.execute(
                        """INSERT INTO option_daily VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        tuple(asdict(bar).values()),
                    )
                except sqlite3.IntegrityError as error:
                    message = f"line {line}: duplicate option/day key"
                    connection.execute(
                        "INSERT INTO option_rejections VALUES (?, ?, ?, ?, ?)",
                        (symbol, source_name, line, message, json.dumps(row, sort_keys=True)),
                    )
                    rejected += 1
                    if len(rejection_samples) < 20:
                        rejection_samples.append({"line": line, "error": message})
                    continue
                first_date = bar.trade_date if first_date is None else min(first_date, bar.trade_date)
                last_date = bar.trade_date if last_date is None else max(last_date, bar.trade_date)
                count += 1
                invalid_ohlc_count += not bar.ohlc_valid
        if count == 0:
            detail = rejection_samples[0]["error"] if rejection_samples else "source has no rows"
            raise HistoricalOptionDataError(f"source contains no valid data rows; {detail}")
        stat = csv_path.stat()
        connection.execute(
            """INSERT OR REPLACE INTO option_sources
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, source_name, stat.st_size, stat.st_mtime_ns, count, rejected, first_date, last_date),
        )
        connection.commit()
        return {
            "symbol": symbol,
            "source_file": source_name,
            "indexed_rows": count,
            "rejected_rows": rejected,
            "ohlc_invalid_rows": invalid_ohlc_count,
            "first_trade_date": first_date,
            "last_trade_date": last_date,
            "rejection_samples": rejection_samples,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def ingest_all(data_dir=DATA_DIR, db_path=DEFAULT_DB):
    """Import the three expected files; each file import is independently atomic."""
    data_dir = Path(data_dir)
    return [
        ingest_csv(data_dir / filename, db_path=db_path, expected_symbol=symbol)
        for symbol, filename in EXPECTED_FILES.items()
    ]


def iter_daily_bars(db_path=DEFAULT_DB, symbol=None, first_day=None, last_day=None):
    """Iterate indexed daily rows in chronological order with bounded memory."""
    clauses, parameters = [], []
    if symbol:
        clauses.append("symbol=?")
        parameters.append(symbol.upper())
    if first_day:
        clauses.append("trade_date>=?")
        parameters.append(date.fromisoformat(first_day).isoformat())
    if last_day:
        clauses.append("trade_date<=?")
        parameters.append(date.fromisoformat(last_day).isoformat())
    sql = "SELECT * FROM option_daily"
    if clauses:
        sql += " WHERE " + " AND ".join(clauses)
    sql += " ORDER BY trade_date, symbol, expiry_date, option_type, strike"
    connection = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        for row in connection.execute(sql, parameters):
            yield dict(row)
    finally:
        connection.close()


def read_daily_bars(db_path=DEFAULT_DB, symbol=None, first_day=None, last_day=None):
    """Convenience list reader for small, explicitly filtered research queries."""
    return list(iter_daily_bars(db_path, symbol, first_day, last_day))


def read_rejections(db_path=DEFAULT_DB, symbol=None):
    """Return quarantined source rows so data-quality exclusions are auditable."""
    connection = sqlite3.connect(Path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        if symbol:
            rows = connection.execute(
                "SELECT * FROM option_rejections WHERE symbol=? ORDER BY line_number",
                (symbol.upper(),),
            )
        else:
            rows = connection.execute(
                "SELECT * FROM option_rejections ORDER BY symbol, line_number"
            )
        return [dict(row) for row in rows]
    finally:
        connection.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", type=Path, default=DATA_DIR)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    args = parser.parse_args()
    try:
        report = ingest_all(args.data_dir, args.db)
    except (HistoricalOptionDataError, OSError, sqlite3.Error) as error:
        parser.exit(1, f"Historical option-data import failed: {error}\n")
    print(json.dumps({"mode": "OFFLINE_READ_ONLY_IMPORT", "datasets": report}, indent=2))


if __name__ == "__main__":
    main()

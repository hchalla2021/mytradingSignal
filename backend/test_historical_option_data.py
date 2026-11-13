import csv
import tempfile
import unittest
from pathlib import Path

from services.historical_option_data import (
    HistoricalOptionDataError,
    ingest_csv,
    read_daily_bars,
    read_rejections,
)


FIELDS = [
    "trade_date", "symbol", "expiry_date", "strike", "option_type",
    "open", "high", "low", "close", "volume_contracts", "open_interest",
    "change_in_open_interest", "underlying_price",
]


def write_source(path, rows):
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def row(**overrides):
    result = {
        "trade_date": "2025-01-02", "symbol": "NIFTY", "expiry_date": "2025-01-30",
        "strike": "23000", "option_type": "CE", "open": "100", "high": "120",
        "low": "90", "close": "110", "volume_contracts": "12", "open_interest": "50",
        "change_in_open_interest": "3", "underlying_price": "",
    }
    result.update(overrides)
    return result


class HistoricalOptionDataTests(unittest.TestCase):
    def test_import_is_repeatable_and_queryable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, database = root / "NIFTY_Option_Data_Historic.csv", root / "history.sqlite3"
            write_source(source, [row(), row(trade_date="2025-01-03", option_type="PE")])
            first = ingest_csv(source, database)
            second = ingest_csv(source, database)
            self.assertEqual(first["indexed_rows"], 2)
            self.assertEqual(second["indexed_rows"], 2)
            bars = read_daily_bars(database, symbol="NIFTY")
            self.assertEqual(len(bars), 2)
            self.assertEqual(bars[0]["trade_date"], "2025-01-02")
            self.assertIsNone(bars[0]["underlying_price"])

    def test_malformed_source_does_not_replace_prior_data(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, database = root / "NIFTY_Option_Data_Historic.csv", root / "history.sqlite3"
            write_source(source, [row()])
            ingest_csv(source, database)
            write_source(source, [row(volume_contracts="")])
            with self.assertRaisesRegex(HistoricalOptionDataError, "no valid data rows"):
                ingest_csv(source, database)
            self.assertEqual(len(read_daily_bars(database, symbol="NIFTY")), 1)

    def test_inconsistent_ohlc_is_indexed_but_flagged_unusable(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, database = root / "NIFTY_Option_Data_Historic.csv", root / "history.sqlite3"
            write_source(source, [row(), row(trade_date="2025-01-03", high="80")])
            report = ingest_csv(source, database)
            self.assertEqual(report["indexed_rows"], 2)
            self.assertEqual(report["rejected_rows"], 0)
            bars = read_daily_bars(database, symbol="NIFTY")
            self.assertTrue(bars[0]["ohlc_valid"])
            self.assertFalse(bars[1]["ohlc_valid"])
            self.assertEqual(read_rejections(database, "NIFTY"), [])

    def test_duplicate_contract_day_is_quarantined(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, database = root / "NIFTY_Option_Data_Historic.csv", root / "history.sqlite3"
            write_source(source, [row(), row()])
            report = ingest_csv(source, database)
            self.assertEqual(report["indexed_rows"], 1)
            self.assertEqual(report["rejected_rows"], 1)
            self.assertIn("duplicate", read_rejections(database, "NIFTY")[0]["error"])

    def test_symbol_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, database = root / "NIFTY_Option_Data_Historic.csv", root / "history.sqlite3"
            write_source(source, [row(symbol="SENSEX")])
            with self.assertRaisesRegex(HistoricalOptionDataError, "expected NIFTY"):
                ingest_csv(source, database)


if __name__ == "__main__":
    unittest.main()

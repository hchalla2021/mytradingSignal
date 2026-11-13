import sqlite3
import tempfile
import unittest
from pathlib import Path

from services.daily_option_proxy_backtest import generate_report, summarize


class DailyOptionProxyBacktestTests(unittest.TestCase):
    def test_selects_one_trade_per_symbol_day_without_lookahead(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "history.sqlite3"
            connection = sqlite3.connect(database)
            connection.execute(
                """CREATE TABLE option_daily (
                    trade_date TEXT, symbol TEXT, expiry_date TEXT, strike REAL,
                    option_type TEXT, open REAL, high REAL, low REAL, close REAL,
                    ohlc_valid INTEGER, volume_contracts INTEGER,
                    open_interest INTEGER, underlying_price REAL
                )"""
            )
            rows = [
                ("2025-01-02", "NIFTY", "2025-01-30", 23000, "CE",
                 100, 120, 90, 110, 1, 100, 500, None),
                ("2025-01-03", "NIFTY", "2025-01-30", 23000, "CE",
                 120, 130, 110, 125, 1, 20, 600, None),
                ("2025-01-02", "NIFTY", "2025-01-30", 23100, "CE",
                 50, 60, 45, 55, 1, 50, 900, None),
                ("2025-01-03", "NIFTY", "2025-01-30", 23100, "CE",
                 60, 70, 55, 50, 1, 300, 800, None),
            ]
            connection.executemany(
                "INSERT INTO option_daily VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
            )
            connection.commit()
            connection.close()

            report = generate_report(database, root / "out")

            self.assertEqual(report["trade_count"], 1)
            trade = report["trades"][0]
            self.assertEqual(trade["strike"], 23000)
            self.assertEqual(trade["signal_date"], "2025-01-02")
            self.assertEqual(trade["entry_date"], "2025-01-03")
            self.assertEqual(trade["gross_return_pct"], (125 - 120) / 120 * 100)
            self.assertTrue((root / "out" / "daily_option_proxy.xlsx").is_file())
            self.assertTrue((root / "out" / "daily_option_proxy.json").is_file())
            self.assertTrue((root / "out" / "daily_option_proxy_trades.csv").is_file())

    def test_summary_handles_no_trades(self):
        summary = summarize([])
        self.assertEqual([row["trade_count"] for row in summary], [0, 0, 0])
        self.assertEqual([row["compounded_return_pct"] for row in summary], [0, 0, 0])


if __name__ == "__main__":
    unittest.main()

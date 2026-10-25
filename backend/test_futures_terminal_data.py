"""Open interest and 5-level DOM data feeding the Futures Advanced Chart terminal."""

import tempfile
import unittest
from datetime import datetime
from pathlib import Path

from services.chart_history_service import ChartHistoryService, normalize_candles
from services.futures_chart_service import FuturesChartService
from services.order_flow_analysis import aggregate, analyze
from services.order_flow_engine import OrderFlowEngine


def tick(when, price, volume, oi=None, depth=None):
    value = {
        "last_price": price, "volume_traded": volume, "exchange_timestamp": when,
        "total_buy_quantity": 120_000, "total_sell_quantity": 80_000,
        "depth": depth or {
            "buy": [{"price": price - 0.1, "quantity": 500, "orders": 4}, {"price": price - 0.2, "quantity": 0, "orders": 0}],
            "sell": [{"price": price + 0.1, "quantity": 300, "orders": 2}],
        },
    }
    if oi is not None:
        value.update(oi=oi, oi_day_high=oi + 1000, oi_day_low=oi - 1000)
    return value


class FuturesTerminalDataTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.engine = OrderFlowEngine(Path(self.directory.name) / "flow.sqlite3")

    def test_configured_database_survives_engine_recreation(self):
        from unittest.mock import patch

        target = Path(self.directory.name) / "persistent" / "flow.sqlite3"
        with patch.dict("os.environ", {"ORDER_FLOW_DB_PATH": str(target)}):
            engine = OrderFlowEngine()
            engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 10, 0, 0), 25000, 1000))
            engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 10, 1, 0), 25001, 1050))
            reopened = OrderFlowEngine()
            self.assertTrue(target.is_file())
            self.assertEqual(len(reopened.session_minutes("NIFTY", "2026-10-19")), 1)

    def test_minutes_record_first_and_last_open_interest_and_bars_expose_it(self):
        base = datetime(2026, 10, 19, 10, 0, 0)
        self.engine.ingest_futures("NIFTY", 7, tick(base, 25000, 1000, oi=5_000_000))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(second=1), 25001, 1050, oi=5_000_750))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(minute=1), 25002, 1100, oi=5_001_500))
        minutes = self.engine.session_minutes("NIFTY", "2026-10-19")
        self.assertEqual((minutes[0]["oio"], minutes[0]["oi"]), (5_000_000, 5_000_750))
        bars = analyze(aggregate(minutes, 5), row=1.0, tick=0.1, now=0)["bars"]
        self.assertEqual((bars[0]["oiOpen"], bars[0]["oi"]), (5_000_000, 5_001_500))

    def test_missing_open_interest_stays_null(self):
        base = datetime(2026, 10, 19, 10, 0, 0)
        self.engine.ingest_futures("NIFTY", 7, tick(base, 25000, 1000))
        self.engine.ingest_futures("NIFTY", 7, tick(base.replace(second=1), 25001, 1050))
        bars = analyze(aggregate(self.engine.session_minutes("NIFTY", "2026-10-19"), 5), row=1.0, tick=0.1, now=0)["bars"]
        self.assertIsNone(bars[0]["oi"])
        self.assertIsNone(bars[0]["oiOpen"])

    def test_dom_keeps_exact_depth_rows_and_drops_empty_levels(self):
        self.assertIsNone(self.engine.dom("NIFTY"))
        self.engine.ingest_futures("NIFTY", 7, tick(datetime(2026, 10, 19, 10, 0, 0), 25000, 1000, oi=42))
        dom = self.engine.dom("NIFTY")
        self.assertEqual(dom["token"], 7)
        self.assertEqual(dom["bids"], [[24999.9, 500.0, 4]])
        self.assertEqual(dom["asks"], [[25000.1, 300.0, 2]])
        self.assertEqual((dom["totalBid"], dom["totalAsk"], dom["oi"]), (120_000.0, 80_000.0, 42.0))
        dom["bids"].clear()
        self.assertEqual(len(self.engine.dom("NIFTY")["bids"]), 1)


class FuturesHistoryOpenInterestTests(unittest.TestCase):
    def test_normalize_keeps_reported_oi_only(self):
        rows = [
            {"date": "2026-10-19T09:15:00+05:30", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 5, "oi": 900},
            {"date": "2026-10-19T09:20:00+05:30", "open": 100, "high": 101, "low": 99, "close": 100, "volume": 5},
        ]
        candles = normalize_candles(rows)
        self.assertEqual(candles[0]["oi"], 900)
        self.assertNotIn("oi", candles[1])

    def test_only_futures_history_requests_open_interest(self):
        self.assertTrue(FuturesChartService.include_oi)
        self.assertFalse(ChartHistoryService.include_oi)


class LatestRecordedSnapshotTests(unittest.IsolatedAsyncioTestCase):
    async def test_empty_today_falls_back_to_last_recorded_session_only_when_requested(self):
        from unittest.mock import patch
        from routers import order_flow as router

        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        engine = OrderFlowEngine(Path(directory.name) / "flow.sqlite3")
        base = datetime(2026, 10, 23, 10, 0, 0)
        for minute in range(3):
            engine.ingest_futures("NIFTY", 7, tick(base.replace(minute=minute), 25000 + minute, 1000 + minute * 50, oi=10))
        router._cache.clear()
        with patch.object(router, "order_flow_engine", engine), patch.object(router, "_today", return_value="2026-10-25"), \
                patch.object(router, "_contract", return_value=None):
            self.assertEqual(engine.stored_sessions("NIFTY"), ["2026-10-23"])
            plain = await router.build_snapshot("NIFTY", 5)
            latest = await router.build_snapshot("NIFTY", 5, latest_recorded=True)
            dated = await router.build_snapshot("NIFTY", 5, day="2026-10-24", latest_recorded=True)
        self.assertFalse(plain["available"])
        self.assertTrue(latest["available"])
        self.assertTrue(latest["latestRecorded"])
        self.assertEqual(latest["date"], "2026-10-23")
        self.assertFalse(dated["available"])
        self.assertNotIn("latestRecorded", dated)


if __name__ == "__main__":
    unittest.main()

import tempfile
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.chart_history_service import (
    ChartHistoryService, ChartHistoryUnavailable, IST, normalize_candles, aggregate_daily_candles,
)


def record(timestamp="2024-10-14T09:15:00+05:30", close=102):
    return {"date": timestamp, "open": 100, "high": 105, "low": 99, "close": close, "volume": 0}


class HistoryNormalizationTests(unittest.TestCase):
    def test_sort_deduplicate_and_keep_true_index_volume(self):
        result = normalize_candles([
            record("2024-10-14T09:20:00+05:30"),
            record(), record(close=103),
        ])
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["c"], 103)
        self.assertEqual(result[0]["v"], 0)
        self.assertTrue(result[0]["t"].endswith("+05:30"))

    def test_invalid_provider_ohlc_is_rejected(self):
        with self.assertRaises(ValueError):
            normalize_candles([record(close=110)])

    def test_weekly_ohlcv_uses_monday_boundaries_and_real_daily_records(self):
        rows = [
            {"date": "2024-10-04T00:00:00+05:30", "open": 100, "high": 110, "low": 95, "close": 105, "volume": 10},
            {"date": "2024-10-07T00:00:00+05:30", "open": 106, "high": 120, "low": 100, "close": 115, "volume": 20},
            {"date": "2024-10-11T00:00:00+05:30", "open": 115, "high": 125, "low": 99, "close": 110, "volume": 30},
        ]
        candles = aggregate_daily_candles(normalize_candles(rows), "W")
        self.assertEqual(len(candles), 2)
        self.assertTrue(candles[0]["t"].startswith("2024-09-30"))
        self.assertTrue(candles[1]["t"].startswith("2024-10-07"))
        self.assertEqual(
            [candles[1][key] for key in ("o", "h", "l", "c", "v")],
            [106, 125, 99, 110, 50],
        )

    def test_monthly_aggregation_separates_calendar_years_and_normalizes_daily_dates(self):
        records = [
            record("2024-12-30T09:15:00+05:30", 101),
            record("2024-12-31T09:15:00+05:30", 103),
            record("2025-01-02T09:15:00+05:30", 104),
        ]
        candles = aggregate_daily_candles(normalize_candles(records), "M")
        self.assertEqual(len(candles), 2)
        self.assertTrue(candles[0]["t"].startswith("2024-12-01T00:00"))
        self.assertTrue(candles[1]["t"].startswith("2025-01-01T00:00"))
        self.assertEqual(candles[0]["c"], 103)
        daily = aggregate_daily_candles(normalize_candles(records), "D")
        self.assertEqual(len(daily), 3)
        self.assertTrue(daily[0]["t"].startswith("2024-12-30T00:00"))


class HistoryPagingTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.service = ChartHistoryService(Path(self.directory.name) / "history.sqlite3")
        self.now = IST.localize(datetime(2026, 10, 18, 12))

    async def test_multi_year_page_is_cached_across_service_instances(self):
        settings = Mock(zerodha_api_key="test", zerodha_access_token="test")
        with patch("services.chart_history_service.get_settings", return_value=settings), \
             patch("services.chart_history_service.KiteConnect") as kite, \
             patch("services.chart_history_service.request_chart_candles", return_value=[record()]) as request:
            page = await self.service.page("NIFTY", 5, date(2024, 10, 15), self.now)
            self.assertEqual(page["nextBefore"], "2024-10-01")
            self.assertEqual(page["candles"][0]["v"], 0)
            self.assertFalse(page["cached"])
            client = kite.return_value
            self.assertEqual(request.call_args_list[0].args[1], 256265)
            self.assertEqual(request.call_args_list[0].args[4], "5minute")
            self.assertIs(request.call_args_list[0].kwargs["continuous"], False)
            self.assertEqual(request.call_args_list[1].args[4], "day")
            self.assertEqual(len(page["dailyCandles"]), 1)
            self.assertTrue(client.set_access_token.called)
        restored = ChartHistoryService(self.service.db_path)
        with patch.object(restored, "_fetch", side_effect=AssertionError("Should use disk cache")):
            cached = await restored.page("NIFTY", 5, date(2024, 10, 15), self.now)
        self.assertTrue(cached["cached"])
        self.assertEqual(cached["candles"], page["candles"])
        self.assertEqual(cached["dailyCandles"], page["dailyCandles"])

    async def test_empty_page_has_an_older_cursor_instead_of_inventing_candles(self):
        with patch.object(self.service, "_fetch", return_value=[]):
            page = await self.service.page("SENSEX", 3, date(2024, 10, 15), self.now)
        self.assertEqual(page["candles"], [])
        self.assertEqual(page["nextBefore"], "2024-10-01")

    async def test_invalid_symbol_interval_and_future_dates_are_rejected(self):
        for symbol, interval, before in [
            ("INVALID", 5, None), ("NIFTY", 1, None),
            ("NIFTY", 5, date(2027, 1, 1)), ("NIFTY", 5, date(1960, 1, 1)),
        ]:
            with self.assertRaises(ValueError):
                await self.service.page(symbol, interval, before, self.now)

    async def test_provider_failure_is_explicit(self):
        with patch.object(self.service, "_fetch", side_effect=RuntimeError("upstream unavailable")), \
             self.assertLogs("services.chart_history_service", level="ERROR"):
            with self.assertRaises(ChartHistoryUnavailable):
                await self.service.page("BANKNIFTY", 15, date(2024, 10, 15), self.now)

    async def test_partial_live_day_cache_is_not_treated_as_final_history(self):
        end = "2024-10-14T23:59:59+05:30"
        start = "2024-10-01T00:00:00+05:30"
        partial_fetch = datetime.fromisoformat(end).timestamp() - 3600
        with self.service._connect() as connection:
            connection.execute(
                "INSERT INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                ("NIFTY", 5, start, end, partial_fetch, "[]"),
            )
        self.assertIsNone(self.service._read("NIFTY", 5, start, end, False))

    async def test_latest_page_fetched_after_close_is_reused_until_next_open(self):
        start, end = "2026-10-05T00:00:00+05:30", "2026-10-19T23:59:59+05:30"
        def store(fetched):
            with self.service._connect() as connection:
                connection.execute("INSERT OR REPLACE INTO pages VALUES (?, ?, ?, ?, ?, ?)",
                                   ("NIFTY", "5", start, end, fetched.timestamp(), "[1]"))
        at = lambda *args: IST.localize(datetime(2026, 10, *args))
        store(at(19, 15, 40))  # Monday after close
        self.assertEqual(self.service._read("NIFTY", "5", start, end, True, at(19, 22, 30)), [1])
        self.assertEqual(self.service._read("NIFTY", "5", start, end, True, at(20, 9, 14)), [1])
        self.assertIsNone(self.service._read("NIFTY", "5", start, end, True, at(20, 9, 16)))
        store(at(19, 11, 0))  # During market hours: 20s freshness only
        self.assertEqual(self.service._read("NIFTY", "5", start, end, True, at(19, 11, 0, 10)), [1])
        self.assertIsNone(self.service._read("NIFTY", "5", start, end, True, at(19, 11, 1)))
        store(at(17, 12, 0))  # Saturday snapshot lasts until Monday open
        self.assertEqual(self.service._read("NIFTY", "5", start, end, True, at(19, 9, 0)), [1])

    async def test_different_symbols_load_concurrently(self):
        import asyncio, threading
        barrier = threading.Barrier(2, timeout=5)
        def fetch(symbol, interval, start, end):
            if interval != "D":
                barrier.wait()  # deadlocks (BrokenBarrierError) if requests were serialized
            return []
        with patch.object(self.service, "_fetch", side_effect=fetch):
            pages = await asyncio.gather(
                self.service.page("BANKNIFTY", 5, date(2024, 10, 15), self.now),
                self.service.page("SENSEX", 5, date(2024, 10, 15), self.now),
            )
        self.assertEqual(len(pages), 2)

    async def test_higher_timeframe_page_cursors_align_without_split_periods(self):
        for interval in ("D", "W", "M"):
            with patch.object(self.service, "_fetch", return_value=[]) as fetch:
                page = await self.service.page("NIFTY", interval, date(2024, 10, 15), self.now)
                cursor = date.fromisoformat(page["nextBefore"])
                if interval == "W":
                    self.assertEqual(cursor.weekday(), 0)
                if interval == "M":
                    self.assertEqual(cursor.day, 1)
                self.assertEqual(fetch.call_args_list[0].args[1], interval)
                self.assertGreater((date(2024, 10, 15) - cursor).days, 300)

    async def test_pivot_context_includes_previous_completed_anchor_period(self):
        for interval in (5, "D", "W", "M"):
            with patch.object(self.service, "_fetch", return_value=[]) as fetch:
                await self.service.page("NIFTY", interval, date(2024, 10, 15), self.now)
            chart_call, context_call = fetch.call_args_list
            start = date.fromisoformat(chart_call.args[2][:10])
            context_start = date.fromisoformat(context_call.args[2][:10])
            self.assertEqual(context_call.args[1], "D")
            self.assertEqual(context_call.args[3], chart_call.args[3])
            if interval in ("W", "M"):
                self.assertEqual(context_start, date(start.year - 1, 1, 1))
            else:
                self.assertEqual((start - context_start).days, 62)

    async def test_all_higher_timeframes_request_real_day_data_from_zerodha(self):
        settings = Mock(zerodha_api_key="test", zerodha_access_token="test")
        for interval in ("D", "W", "M"):
            with patch("services.chart_history_service.get_settings", return_value=settings), \
                 patch("services.chart_history_service.KiteConnect"), \
                 patch("services.chart_history_service.request_chart_candles", return_value=[record()]) as request:
                page = await self.service.page("BANKNIFTY", interval, date(2024, 10, 15), self.now)
                self.assertEqual(request.call_args.args[1], 260105)
                self.assertEqual(request.call_args.args[4], "day")
                self.assertEqual(len(page["candles"]), 1)
                self.assertEqual(page["candles"][0]["v"], 0)


class HistoryRouteTests(unittest.TestCase):
    def test_bad_date_is_422_and_provider_failure_is_503(self):
        from routers.chart_intelligence import http_router
        app = FastAPI()
        app.include_router(http_router, prefix="/api")
        with TestClient(app) as client:
            result = client.get("/api/chart-intelligence/history?before=not-a-date")
            self.assertEqual(result.status_code, 422)
            with patch("routers.chart_intelligence.chart_history_service.page",
                       side_effect=ChartHistoryUnavailable("Reconnect Zerodha")):
                result = client.get("/api/chart-intelligence/history")
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.json()["detail"], "Reconnect Zerodha")


if __name__ == "__main__":
    unittest.main()

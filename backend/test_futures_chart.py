import tempfile
import threading
import unittest
from datetime import date, datetime
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from services.chart_history_service import ChartHistoryUnavailable, ChartHistoryService, IST
from services.futures_chart_service import FuturesChartService


def instrument(symbol, token, expiry, exchange="NFO", kind="FUT"):
    return {
        "name": symbol, "instrument_token": token, "expiry": expiry,
        "tradingsymbol": f"{symbol}{expiry:%y%b}FUT".upper(),
        "exchange": exchange, "instrument_type": kind, "lot_size": 65, "tick_size": 0.05,
    }


class FuturesChartTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        local = patch("services.chart_history_service._client_local", threading.local())
        local.start()
        self.addCleanup(local.stop)
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / "history.sqlite3"
        self.service = FuturesChartService(self.path)
        self.now = IST.localize(datetime(2026, 10, 20, 12))
        self.rows = [
            instrument("NIFTY", 101, date(2026, 10, 27)),
            instrument("NIFTY", 102, date(2026, 11, 24)),
            instrument("NIFTY", 103, date(2026, 12, 29)),
            instrument("NIFTY", 104, date(2027, 1, 26)),
            instrument("NIFTY", 99, date(2026, 9, 29)),
            instrument("NIFTY", 98, date(2026, 10, 27), kind="CE"),
            instrument("NIFTYNXT50", 97, date(2026, 10, 27)),
            instrument("BANKNIFTY", 201, date(2026, 10, 27)),
            instrument("SENSEX", 301, date(2026, 10, 29), exchange="BFO"),
        ]

    async def test_actual_expiries_and_listed_2027_contracts_without_fabrication(self):
        with patch.object(self.service, "_fetch_instruments", return_value=self.rows) as request:
            result = await self.service.contracts("NIFTY", self.now)
            self.assertEqual([row["token"] for row in result], [101, 102, 103, 104])
            self.assertEqual(result[0]["expiry"], "2026-10-27")
            self.assertEqual(result[-1]["expiry"], "2027-01-26")
            self.assertEqual(len(await self.service.contracts("BANKNIFTY", self.now)), 1)
            request.assert_called_once_with("NFO")
            result = await self.service.contracts("SENSEX", self.now)
            self.assertEqual(result[0]["exchange"], "BFO")
            self.assertEqual(result[0]["token"], 301)
            self.assertEqual(request.call_count, 2)

    async def test_expired_cached_contracts_are_filtered_when_date_changes(self):
        with patch.object(self.service, "_fetch_instruments", return_value=self.rows) as request:
            await self.service.contracts("NIFTY", self.now)
            later = IST.localize(datetime(2026, 10, 28, 12))
            result = await self.service.contracts("NIFTY", later)
            self.assertNotIn(101, [row["token"] for row in result])
            self.assertEqual(request.call_count, 1)

    async def test_arbitrary_cross_symbol_expired_and_unlisted_tokens_are_rejected(self):
        with patch.object(self.service, "_fetch_instruments", return_value=self.rows):
            for token in (201, 99, 999):
                with self.assertRaises(ValueError):
                    await self.service.page("NIFTY", "5", token, now=self.now)
            with self.assertRaises(ValueError):
                await self.service.page("NIFTY", "2", 101, now=self.now)
            with self.assertRaises(ValueError):
                await self.service.contracts("INVALID", self.now)

    async def test_contract_specific_history_and_cache_never_mix_cash_or_expiries(self):
        rows = [{"date": "2026-10-19T09:15:00+05:30", "open": 100,
                 "high": 105, "low": 99, "close": 102, "volume": 650}]
        settings = Mock(zerodha_api_key="test", zerodha_access_token="test")
        with patch.object(self.service, "_fetch_instruments", return_value=self.rows), \
             patch("services.chart_history_service.get_settings", return_value=settings), \
             patch("services.chart_history_service.KiteConnect"), \
             patch("services.chart_history_service.request_chart_candles", return_value=rows) as request:
            first = await self.service.page("NIFTY", "5", 101, date(2026, 10, 20), self.now)
            second = await self.service.page("NIFTY", "5", 102, date(2026, 10, 20), self.now)
            self.assertEqual(first["candles"][0]["v"], 650)
            self.assertEqual(first["source"], "ZERODHA_FUTURES")
            self.assertEqual(first["volumeSource"], "SAME_FUTURES_CONTRACT")
            self.assertEqual(first["contract"]["token"], 101)
            self.assertEqual(second["contract"]["token"], 102)
            self.assertEqual(first["dailyCandles"], [])
            self.assertEqual([call.args[1] for call in request.call_args_list], [101, 102])
            self.assertTrue(all(call.kwargs["continuous"] is False for call in request.call_args_list))
            cached = await self.service.page("NIFTY", "5", 101, date(2026, 10, 20), self.now)
            self.assertTrue(cached["cached"])
            self.assertEqual(request.call_count, 2)
        cash = ChartHistoryService(self.path)
        with patch.object(cash, "_fetch", return_value=[]) as request:
            await cash.page("NIFTY", "5", date(2026, 10, 20), self.now)
            self.assertEqual(request.call_count, 2)

    async def test_instrument_fetch_failure_is_explicit_and_not_cached(self):
        with patch.object(self.service, "_fetch_instruments", side_effect=RuntimeError("unavailable")), \
             self.assertLogs("services.futures_chart_service", level="ERROR"):
            with self.assertRaises(ChartHistoryUnavailable):
                await self.service.contracts("NIFTY", self.now)
        self.assertEqual(self.service._instruments, {})
        with patch.object(self.service, "_fetch_instruments", return_value=[]):
            with self.assertRaises(ChartHistoryUnavailable):
                await self.service.contracts("NIFTY", self.now)


class FuturesRouteTests(unittest.TestCase):
    def test_parameter_validation_and_provider_errors(self):
        from routers.chart_intelligence import http_router
        app = FastAPI()
        app.include_router(http_router, prefix="/api")
        with TestClient(app) as client:
            for query in ("", "?token=-1", "?token=1&before=not-a-date"):
                self.assertEqual(client.get("/api/chart-intelligence/futures/history" + query).status_code, 422)
            with patch("routers.chart_intelligence.futures_chart_service.contracts",
                       new=AsyncMock(side_effect=ChartHistoryUnavailable("Reconnect Zerodha"))):
                result = client.get("/api/chart-intelligence/futures/contracts")
                self.assertEqual(result.status_code, 503)
                self.assertEqual(result.json()["detail"], "Reconnect Zerodha")
            with patch("routers.chart_intelligence.futures_chart_service.page",
                       new=AsyncMock(side_effect=ValueError("Invalid contract"))):
                self.assertEqual(client.get("/api/chart-intelligence/futures/history?token=1").status_code, 422)


if __name__ == "__main__":
    unittest.main()

import json
import asyncio
import threading
import time
import unittest
from unittest.mock import AsyncMock, Mock, patch

from services.chart_intelligence_service import ChartIntelligenceService
from services.cache import _SHARED_CACHE


class ChartLiveRefreshTests(unittest.IsolatedAsyncioTestCase):
    async def test_dashboard_model_inference_cannot_block_chart_stream_event_loop(self):
        from services.trading_intelligence_engine import TradingIntelligenceEngine
        engine = TradingIntelligenceEngine()
        loop_thread = threading.get_ident()

        def infer(symbol, tick):
            self.assertNotEqual(threading.get_ident(), loop_thread)
            self.assertEqual(symbol, "NIFTY")
            return {"price": tick["price"]}

        with patch.object(engine.cache, "get_market_data", AsyncMock(return_value={"price": 100})), \
             patch.object(engine, "infer", side_effect=infer):
            self.assertEqual(await engine.refresh_from_cache("NIFTY"), {"price": 100})

    async def test_history_completion_uses_latest_price_not_price_before_slow_fetch(self):
        service = ChartIntelligenceService()
        with patch("services.chart_intelligence_service.SYMBOLS", ["NIFTY"]), \
             patch.object(service, "_get_spot_price", side_effect=[100, 105]), \
             patch.object(service, "_fetch_candles_sync", return_value=[{"c": 100}]), \
             patch.object(service, "_fetch_daily_sync", return_value=[]), \
             patch.object(service, "_build_symbol_data", return_value={"spot": 105}) as build:
            await service._bg_fetch_live("LIVE")
            self.assertEqual(build.call_args.args[4], 105)

    async def test_live_price_refresh_continues_while_history_request_is_pending(self):
        service = ChartIntelligenceService()
        service._running = True
        service._last_snapshot = {"NIFTY": {"spot": 100}}
        service._last_full_fetch = 0
        service._last_save_time = time.time()
        service._fetch_task = asyncio.get_running_loop().create_future()
        refresh = Mock(return_value={"spot": 105})

        async def broadcast(message):
            self.assertEqual(message["data"]["NIFTY"]["spot"], 105)
            service._running = False

        try:
            with patch.object(service, "_get_market_phase", return_value="LIVE"), \
                 patch.object(service, "_init_kite"), \
                 patch.object(service, "_refresh_entry_with_live_spot", refresh), \
                 patch("services.chart_intelligence_service.chart_intel_manager.broadcast",
                       AsyncMock(side_effect=broadcast)) as send:
                await asyncio.wait_for(service._run_loop(), timeout=3)
                refresh.assert_called_once()
                send.assert_awaited_once()
        finally:
            service._fetch_task.cancel()


class ChartIntelligenceVolumeTrackingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.service = ChartIntelligenceService()
        _SHARED_CACHE.clear()

    def tearDown(self) -> None:
        _SHARED_CACHE.clear()

    def _set_market_volume(self, symbol: str, volume: int) -> None:
        _SHARED_CACHE[f"market:{symbol}"] = (
            json.dumps({"volume": volume}),
            time.time() + 60,
        )

    def test_volume_baseline_is_tracked_per_timeframe(self) -> None:
        symbol = "NIFTY"

        self._set_market_volume(symbol, 100)
        self.assertEqual(self.service._get_live_candle_volume(symbol, "2026-05-13T09:15", 3), 0)

        self._set_market_volume(symbol, 110)
        self.assertEqual(self.service._get_live_candle_volume(symbol, "2026-05-13T09:18", 3), 0)

        self._set_market_volume(symbol, 120)
        self.assertEqual(self.service._get_live_candle_volume(symbol, "2026-05-13T09:15", 5), 0)

        self._set_market_volume(symbol, 130)
        volume_3m = self.service._get_live_candle_volume(symbol, "2026-05-13T09:18", 3)

        self.assertEqual(volume_3m, 20 * self.service._LOT_SIZES[symbol])


if __name__ == "__main__":
    unittest.main()
import json
import time
import unittest

from services.chart_intelligence_service import ChartIntelligenceService
from services.cache import _SHARED_CACHE


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
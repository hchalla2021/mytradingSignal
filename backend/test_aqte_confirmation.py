import unittest
from datetime import datetime, timezone

from services.aqte_confirmation_service import AQTEConfirmationService


class CacheStub:
    async def get_market_data(self, symbol):
        return {
            "price": 22000,
            "close": 21900,
            "high": 22100,
            "low": 21800,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "status": "LIVE",
            "analysis": {"vwap": 21980},
        }

    async def lrange(self, key, start, end):
        return []


class StrategyLabStub:
    async def evaluate(self, symbol, tick, indicators):
        return {
            "strategy_lab": {
                "updated": 1,
                "consensus": {"fired": True, "signal": "BUY_CE"},
            },
            "market_direction": {"label": "BULLISH"},
            "early_warning": {"state": "NONE"},
        }


class AQTEConfirmationTests(unittest.IsolatedAsyncioTestCase):
    async def test_confirmation_provider_publishes_fresh_lab_without_order_methods(self):
        service = AQTEConfirmationService(CacheStub())
        service._strategy_lab = StrategyLabStub()

        await service._tick_symbol("NIFTY")

        result = service.get_result("NIFTY")
        self.assertEqual(result["data_status"], "LIVE")
        self.assertLessEqual(result["tick_age_seconds"], 1)
        self.assertEqual(result["strategy_lab"]["consensus"]["signal"], "BUY_CE")
        self.assertEqual(result["market_direction"]["label"], "BULLISH")
        self.assertFalse(hasattr(service, "_maybe_execute_trade"))
        self.assertFalse(hasattr(service, "_exit_position"))


if __name__ == "__main__":
    unittest.main()

import unittest
from datetime import datetime

from services.market_session_controller import IST, MarketPhase, MarketSessionController


class MarketSessionControllerTests(unittest.TestCase):
    def test_confirmed_2026_11_09_session_is_live_during_market_hours(self):
        now = IST.localize(datetime(2026, 11, 9, 12, 0))
        self.assertEqual(MarketSessionController.get_current_phase(now), MarketPhase.LIVE)


if __name__ == "__main__":
    unittest.main()

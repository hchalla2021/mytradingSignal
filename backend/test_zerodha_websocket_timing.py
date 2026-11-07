import unittest
from unittest.mock import patch

from services.zerodha_websocket_manager import ZerodhaWebSocketManager


class ZerodhaWebSocketTimingTests(unittest.TestCase):
    def setUp(self):
        self.manager = ZerodhaWebSocketManager("test-key", "test-token", [])

    def test_websocket_starts_at_preopen(self):
        with patch("services.zerodha_websocket_manager.datetime") as mocked_datetime:
            mocked_datetime.now.return_value.strftime.return_value = "08:59:59"
            self.assertFalse(self.manager._should_start_websocket())

            mocked_datetime.now.return_value.strftime.return_value = "09:00:00"
            self.assertTrue(self.manager._should_start_websocket())
            mocked_datetime.now.return_value.weekday.return_value = 0
            self.assertTrue(self.manager._is_market_time())
            self.assertFalse(self.manager._is_market_open())

    def test_market_open_remains_at_0915(self):
        with patch("services.zerodha_websocket_manager.datetime") as mocked_datetime:
            mocked_datetime.now.return_value.strftime.return_value = "09:14:59"
            self.assertFalse(self.manager._is_market_open())

            mocked_datetime.now.return_value.strftime.return_value = "09:15:00"
            self.assertTrue(self.manager._is_market_open())


if __name__ == "__main__":
    unittest.main()
